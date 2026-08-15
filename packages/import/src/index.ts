export {
  detectSourceFormat,
  LATEX_FORMAT_MARKERS,
  MARKDOWN_FORMAT_MARKERS,
} from "./lib/detect-source-format";
export {
  convertLatexToPretext,
  convertMarkdownToPretext,
  normalizePretextSource,
  convertSourceToPretext,
  getConversionErrorMessage,
} from "./lib/convert";
export type {
  LatexConversionResult,
  MarkdownConversionResult,
} from "./lib/convert";
export {
  importProjectFromFiles,
  handleImportUploadFile,
  extractUpload,
  relayoutImport,
  resolveImportSplitLevel,
  type ExtractedUpload,
  type ImportProjectOptions,
  type SplitLevelContext,
} from "./lib/upload";
export {
  LATEX_DIVISION_COMMANDS,
  findLatexHeaders,
  latexDivisionHierarchy,
  parseLatexDivisions,
  divisionsAtLevel,
  suggestSplitLevel,
  MAX_SUGGESTED_SPLIT_LEVEL,
  type LatexDivision,
  type LatexDivisionCommand,
} from "./lib/latex-split";
export {
  fileChangesForImport,
  type FileChangeRecord,
} from "./lib/file-changes";
export {
  diffLines,
  diffHunks,
  diffStats,
  type DiffLine,
  type DiffHunk,
  type DiffStats,
} from "./lib/diff";
export {
  cleanLatexInChunks,
  mergeChunksAtLevel,
  type CleanedChunk,
  type CleanLatexChunksResult,
} from "./lib/clean/clean-chunks";
export {
  analyzeImportSources,
  type AnalyzeOptions,
  type RootCandidate,
  type RootReason,
  type UploadAnalysis,
} from "./lib/project/analyze";
export {
  attachLatexRoots,
  attachMarkdownRoots,
  defaultAttachLevel,
  type AttachLevel,
  type AttachedRootRecord,
  type AttachRootsResult,
  type RootAttachment,
} from "./lib/project/attach-roots";
export {
  defaultManifestTarget,
  findProjectManifest,
  parseProjectManifest,
  type ManifestTarget,
  type ProjectManifest,
} from "./lib/project/manifest";
export {
  carryOverProjectFiles,
  renderProjectPtxFromManifest,
  type CarryOverOptions,
  type CarryOverResult,
} from "./lib/project/existing-project";
export {
  PRETEXT_DIVISION_TAGS,
  PRETEXT_ROOT_TAGS,
  filePrefixForDivision,
  isDivisionTag,
  type PretextDivisionTag,
  type PretextRootTag,
} from "./lib/pretext-divisions";
export {
  filesForImportMode,
  assetsForImportMode,
  projectForImportMode,
  formatWarningLine,
  type ImportMode,
} from "./lib/import-mode";
export { cleanLatex, fixesToWarnings } from "./lib/clean/clean-latex";
export type {
  CleanLatexOptions,
  CleanLatexResult,
} from "./lib/clean/clean-latex";
// Re-exported so a host that only depends on @pretextbook/import can read the
// positioned fixes behind a change report without adding a second dependency.
export {
  CLEAN_RULES,
  findLatexFixes,
  applyLatexFixes,
  cleanLatexText,
  getLatexCleanDiagnostics,
  latexFixesToCodeActions,
} from "@pretextbook/latex-style-pretext";
export type {
  CleanRule,
  CleanScope,
  FindFixesOptions,
  LatexFix,
} from "@pretextbook/latex-style-pretext";
export { expandPretextIncludes } from "./lib/clean/pretext-includes";
export type {
  CleaningWarning,
  CleaningSeverity,
  CleaningAction,
} from "./lib/clean/warnings";
export {
  buildPretextProjectFiles,
  detectDocumentKind,
  renderProjectPtx,
  renderPublicationPtx,
} from "./lib/layout";
export type {
  BuildProjectFilesOptions,
  BuildProjectFilesResult,
  DocumentKind,
} from "./lib/layout";
export {
  buildDivisionPool,
  resolveSplitLevel,
  buildNativeDivisionPool,
  sanitizeRef,
  serializeProjectToFiles,
  serializeProjectToPlusPayload,
  divisionChildRefs,
} from "./lib/pool";
export type {
  BuildDivisionPoolOptions,
  BuildDivisionPoolResult,
  BuildNativeDivisionPoolOptions,
  SerializeProjectFilesOptions,
  SerializedProjectFiles,
} from "./lib/pool";
export type {
  SourceFormat,
  ProjectLayout,
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
  PlusDivisionAttributes,
  PlusAssetAttributes,
  PlusAssetFile,
  ImportedProjectResult,
  ImportedProjectSuccess,
  ImportedProjectError,
} from "./lib/types";
