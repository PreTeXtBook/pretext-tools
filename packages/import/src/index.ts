export {
  detectSourceFormat,
  LATEX_FORMAT_MARKERS,
  MARKDOWN_FORMAT_MARKERS,
} from './lib/detect-source-format';
export {
  convertLatexToPretext,
  convertMarkdownToPretext,
  normalizePretextSource,
  convertSourceToPretext,
  getConversionErrorMessage,
} from './lib/convert';
export type {
  LatexConversionResult,
  MarkdownConversionResult,
} from './lib/convert';
export {
  importProjectFromFiles,
  handleImportUploadFile,
  type ImportProjectOptions,
} from './lib/upload';
export {
  filesForImportMode,
  assetsForImportMode,
  formatWarningLine,
  type ImportMode,
} from './lib/import-mode';
export { cleanLatex } from './lib/clean/clean-latex';
export type { CleanLatexResult } from './lib/clean/clean-latex';
export { expandPretextIncludes } from './lib/clean/pretext-includes';
export type {
  CleaningWarning,
  CleaningSeverity,
  CleaningAction,
} from './lib/clean/warnings';
export {
  buildPretextProjectFiles,
  detectDocumentKind,
  renderProjectPtx,
  renderPublicationPtx,
} from './lib/layout';
export type {
  BuildProjectFilesOptions,
  BuildProjectFilesResult,
  DocumentKind,
} from './lib/layout';
export {
  buildDivisionPool,
  sanitizeRef,
  serializeProjectToFiles,
  serializeProjectToPlusPayload,
  divisionChildRefs,
} from './lib/pool';
export type {
  BuildDivisionPoolOptions,
  BuildDivisionPoolResult,
  SerializeProjectFilesOptions,
  SerializedProjectFiles,
} from './lib/pool';
export type {
  SourceFormat,
  ConversionContext,
  ConvertedPretextResult,
  UploadStatusType,
  UploadStatusMessage,
  UploadSourceType,
  ImportedProject,
  ImportedDivision,
  ImportedDivisionType,
  ImportedAsset,
  PlusProjectPayload,
  PlusDivisionRecord,
  PlusAssetRecord,
  ImportedProjectResult,
  ImportedProjectSuccess,
  ImportedProjectError,
} from './lib/types';
