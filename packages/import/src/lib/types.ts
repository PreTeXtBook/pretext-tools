import type { CleanedChunk } from "./clean/clean-chunks";
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
 * (SPEC §4.1). Serialize with `serializeProjectToFiles` (VS Code file tree)
 * or `serializeProjectToPlusPayload` (pretext-plus).
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
