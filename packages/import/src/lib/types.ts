import type { CleaningWarning } from './clean/warnings';
import type { DocumentKind } from './layout/document-kind';

export type SourceFormat = 'latex' | 'markdown' | 'pretext';

export interface ConversionContext {
  sourceFormat: SourceFormat;
  detectedSourceFormat: SourceFormat;
}

export interface ConvertedPretextSuccess extends ConversionContext {
  pretextSource: string;
  warnings: CleaningWarning[];
  cleanedNativeSource?: string;
}

export interface ConvertedPretextError extends ConversionContext {
  pretextError: string;
  warnings: CleaningWarning[];
}

export type ConvertedPretextResult =
  | ConvertedPretextSuccess
  | ConvertedPretextError;

export type UploadStatusType = 'loading' | 'success' | 'error';

export type UploadSourceType =
  | 'tex'
  | 'markdown'
  | 'pretext'
  | 'zip'
  | 'tar.gz';

export interface UploadStatusMessage {
  type: UploadStatusType;
  message: string;
}

/**
 * The PreTeXt element type of an imported division. Values match the XML tag
 * name. Only the types the import pipeline currently emits are listed; the
 * pretext-plus editor accepts many more.
 */
export type ImportedDivisionType = 'book' | 'article' | 'chapter' | 'section';

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

/** One division row of the pretext-plus create/update payload (SPEC §4.3). */
export interface PlusDivisionRecord {
  /** Client-minted UUID; Rails inserts it as the record's primary key. */
  id: string;
  /** The division's `xml:id` (Rails column `ref`). */
  ref: string;
  source: string;
  sourceFormat: SourceFormat;
  isRoot: boolean;
}

/** One asset row of the pretext-plus payload; bytes attach as `file`. */
export interface PlusAssetRecord {
  id: string;
  ref: string;
  kind: 'file';
  /** → `short_description` and the multipart upload filename. */
  fileName: string;
  data: Uint8Array;
}

/**
 * Direct camelCase mirror of what pretext-plus's `ProjectsController`
 * permits (`divisions_attributes` / `assets_attributes`) — see SPEC §4.3.
 */
export interface PlusProjectPayload {
  title: string;
  docinfo: string;
  documentType: DocumentKind;
  divisions: PlusDivisionRecord[];
  assets: PlusAssetRecord[];
}

export interface ImportedProjectSuccess extends ConversionContext {
  pretextSource: string;
  sourcePath: string;
  sourceName: string;
  sourceType: UploadSourceType;
  documentKind: DocumentKind;
  /** Intermediate model of the imported project (SPEC §4.1). */
  project: ImportedProject;
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
  outputFiles: Record<string, string>;
  outputAssets: Record<string, Uint8Array>;
  nativeOutputFiles?: Record<string, string>;
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
