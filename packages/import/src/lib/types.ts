import type { CleanedChunk } from "./clean/clean-chunks";
import type { ImportDestination } from "./insert/destination";
import type { XmlIdRename } from "./insert/dedupe-ids";
import type { DivisionPath } from "./select/divisions";
import type { CleaningWarning } from "./clean/warnings";
import type { DocumentKind } from "./layout/document-kind";
import type { PretextDivisionTag, PretextRootTag } from "./pretext-divisions";
import type { UploadAnalysis } from "./project/analyze";
import type { AttachedRootRecord } from "./project/attach-roots";

export type SourceFormat = "latex" | "markdown" | "pretext";

export interface ConversionContext {
  sourceFormat: SourceFormat;
  detectedSourceFormat: SourceFormat;
}

export interface ConvertedPretextSuccess extends ConversionContext {
  pretextSource: string;
  warnings: CleaningWarning[];
  cleanedNativeSource?: string;
  /** Per-division before/after cleaning record; empty for non-LaTeX input. */
  cleanChunks?: CleanedChunk[];
}

export interface ConvertedPretextError extends ConversionContext {
  pretextError: string;
  warnings: CleaningWarning[];
}

export type ConvertedPretextResult =
  | ConvertedPretextSuccess
  | ConvertedPretextError;

export type UploadStatusType = "loading" | "success" | "error";

export type UploadSourceType =
  | "tex"
  | "markdown"
  | "pretext"
  | "zip"
  | "tar.gz";

export interface UploadStatusMessage {
  type: UploadStatusType;
  message: string;
}

/**
 * The PreTeXt element type of an imported division. Values match the XML tag
 * name: either a document root (`book`/`article`) or any division the splitter
 * can lift into its own file (see `pretext-divisions.ts`).
 */
export type ImportedDivisionType = PretextRootTag | PretextDivisionTag;

/**
 * One division record in the intermediate model (SPEC §4.1): a flat pool of
 * divisions whose hierarchy is expressed by `<plus:TYPE ref="…"/>`
 * placeholders inside parent `content` — the same storage model as
 * pretext-plus. The file-tree serializer rewrites placeholders to
 * `<xi:include>`; the plus payload passes them through unchanged.
 */
export interface ImportedDivision {
  /** The division's `xml:id`; unique within the pool (and vs. asset refs). */
  xmlId: string;
  type: ImportedDivisionType;
  /** Plain-text title (from the division's `<title>`). */
  title: string;
  sourceFormat: SourceFormat;
  /**
   * Full division source including the wrapper element, with direct-child
   * divisions replaced by `<plus:TYPE ref="…"/>` placeholders.
   */
  content: string;
  isRoot: boolean;
}

/** A binary asset carried by ref, mirroring pretext-plus's Asset model. */
export interface ImportedAsset {
  /** Unique among divisions + assets; REF_REGEX-safe. */
  ref: string;
  /** Original basename (used for display / upload filename). */
  fileName: string;
  data: Uint8Array;
}

/**
 * The host-independent intermediate model of an imported project
 * (SPEC §4.1). Serialize with `serializeProjectToFiles` (a file tree) or
 * `serializeProjectToRecords` (a flat, ref-addressed projection for a host that
 * stores divisions rather than files).
 */
export interface ImportedProject {
  title: string;
  /** Full `<docinfo>…</docinfo>` element, or `""`. Kept out of division content. */
  docinfo: string;
  documentKind: DocumentKind;
  /** Exactly one division has `isRoot: true`. */
  divisions: ImportedDivision[];
  assets: ImportedAsset[];
}

/**
 * One division of the flat, ref-addressed projection (SPEC §4.3) — the shape a
 * host that stores divisions in a database wants, as against the file tree
 * `serializeProjectToFiles` produces. Hierarchy lives in the `<plus:TYPE
 * ref="…"/>` placeholders inside `source`, not in the record.
 */
export interface DivisionRecord {
  /** The division's `xml:id`. */
  ref: string;
  source: string;
  sourceFormat: SourceFormat;
  isRoot: boolean;
}

/** One asset of the record projection, its bytes base64-encoded. */
export interface AssetRecord {
  ref: string;
  fileName: string;
  contentType: string;
  /** Base64-encoded bytes, so the projection travels as JSON. */
  data: string;
}

/**
 * The record projection of an imported project (SPEC §4.3). Consumer-neutral:
 * `recordsToPlusPayload` renames these fields for pretext-plus's endpoint, and
 * another hosted consumer would write its own adapter rather than inherit
 * someone else's field names.
 */
export interface ProjectRecords {
  title: string;
  docinfo: string;
  documentKind: DocumentKind;
  divisions: DivisionRecord[];
  assets: AssetRecord[];
}

/**
 * One division row of the pretext-plus import payload (`divisions_attributes`
 * on `POST /projects/import`). New rows only — `ProjectsController#import_params`
 * permits no `id`/`_destroy` there (imports never edit or delete existing rows).
 */
export interface PlusDivisionAttributes {
  /** The division's `xml:id` (Rails column `ref`). */
  ref: string;
  source: string;
  source_format: SourceFormat;
  is_root: boolean;
}

/**
 * An asset's file upload. Bytes travel base64-encoded, since the whole import
 * posts as one JSON body — `import_params` decodes `data` back into an
 * ActiveStorage attachable server-side.
 */
export interface PlusAssetFile {
  filename: string;
  content_type: string;
  data: string;
}

/** One asset row of the pretext-plus import payload (`assets_attributes`). */
export interface PlusAssetAttributes {
  ref: string;
  kind: "file";
  title: string;
  short_description: string;
  file: PlusAssetFile;
}

/**
 * Wire shape of `POST /projects/import`
 * (`ProjectsController#create_from_import` / `import_params`) — a direct
 * snake_case mirror, since the endpoint permits no `id` on either nested
 * attribute.
 */
export interface PlusProjectPayload {
  title: string;
  docinfo: string;
  document_type: DocumentKind;
  divisions_attributes: PlusDivisionAttributes[];
  assets_attributes: PlusAssetAttributes[];
}

/**
 * Where the imported project's own scaffolding files live. For an upload that
 * carried a `project.ptx`, these are the paths that project already used, so
 * its publication file and image references keep resolving.
 */
export interface ProjectLayout {
  /** Path of the root source file within the written project. */
  mainSourcePath: string;
  /** Path of the publication file within the written project. */
  publicationPath: string;
  /** Path of the manifest within the written project. */
  projectFilePath: string;
  /** True when an existing project's layout and publication file were kept. */
  preserved: boolean;
}

/**
 * What an `insert` destination did to the document on its way into the host
 * project (SPEC §9.2). Absent for a new-project import.
 */
export interface InsertRecord {
  /** True when the document wrapper was dropped in favour of its children. */
  unwrapRoot: boolean;
  /** `<xi:include>` elements for the host to splice in at the cursor. */
  includes: string[];
  /** `xml:id`s renamed because the host project already used them. */
  renamed: XmlIdRename[];
  /** Rungs the document's divisions were shifted down the ladder. */
  retargetDelta: number;
  /**
   * `pretextSource` after retargeting and de-colliding — what was actually
   * split and written. `pretextSource` itself stays the raw conversion, so the
   * attach level can be changed later without re-converting (and without
   * shifting an already-shifted document a second time).
   */
  preparedSource: string;
}

export interface ImportedProjectSuccess extends ConversionContext {
  pretextSource: string;
  /** Cleaned but unconverted source, when the input was LaTeX or Markdown. */
  cleanedNativeSource?: string;
  sourcePath: string;
  sourceName: string;
  sourceType: UploadSourceType;
  documentKind: DocumentKind;
  /**
   * The survey of the upload that drove this import — the manifest it found,
   * every root it could have used, and the formats on offer. Hosts render
   * their format/main-file pickers from this and re-run the import with the
   * user's choices as `ImportProjectOptions`.
   */
  analysis: UploadAnalysis;
  /** Extra roots folded into the main document (SPEC §3.3). */
  attachedRoots: AttachedRootRecord[];
  /** Scaffolding paths used for the written project. */
  projectLayout: ProjectLayout;
  /** Intermediate model of the imported project (SPEC §4.1). */
  project: ImportedProject;
  /**
   * Native-format (LaTeX/Markdown) projection of the same import, split into
   * divisions joined by `\plus{…}{…}` / `::…{ref="…"}` placeholders (SPEC
   * §4.3). Present only when the source was LaTeX or Markdown; the pretext-plus
   * host serializes this instead of `project` when the user keeps the native
   * format. `undefined` for PreTeXt input.
   */
  nativeProject?: ImportedProject;
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
  outputFiles: Record<string, string>;
  outputAssets: Record<string, Uint8Array>;
  nativeOutputFiles?: Record<string, string>;
  /**
   * The cleaned source cut at every division header, each piece carrying its own
   * before/after text and fix list (SPEC §3.5). Cut at the deepest level the
   * document has, so a host can show any split depth by folding adjacent chunks
   * (`mergeChunksAtLevel`) without re-running the import.
   */
  cleanChunks: CleanedChunk[];
  /** The split depth this result was laid out at. */
  splitLevel: number;
  /**
   * Which divisions this import kept, by `DivisionPath` (SPEC §9, step 6).
   * Absent when the whole document was imported.
   */
  selection?: DivisionPath[];
  /**
   * Warnings from the stages a rebuild redoes — the selection prune and the
   * insert preparation. Also present in `warnings`; held separately so
   * `rebuildImport` can replace exactly these rather than accumulate a set per
   * attempt, since an author trying three attach levels should be left with one
   * overflow notice, not three.
   */
  rebuiltWarnings: CleaningWarning[];
  /**
   * Where this import went. Carried on the result so `relayoutImport` cannot
   * silently regenerate a project scaffold the moment an author changes the
   * split level during an insertion (SPEC §9.2).
   */
  destination: ImportDestination;
  /** Present only for an `insert` destination. */
  insert?: InsertRecord;
  statusMessages: UploadStatusMessage[];
  warnings: CleaningWarning[];
}

export interface ImportedProjectError {
  pretextError: string;
  statusMessages: UploadStatusMessage[];
  warnings: CleaningWarning[];
}

export type ImportedProjectResult =
  | ImportedProjectSuccess
  | ImportedProjectError;
