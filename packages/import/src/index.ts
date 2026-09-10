export {
  detectSourceFormat,
  LATEX_FORMAT_MARKERS,
  MARKDOWN_FORMAT_MARKERS,
} from "./lib/detect-source-format";
export {
  detectSnippetFormat,
  scoreSnippetFormats,
  type SnippetFormat,
  type SnippetFormatScores,
} from "./lib/detect-snippet-format";
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
  rebuildImport,
  retargetImport,
  reselectImport,
  resolveImportSplitLevel,
  type ExtractedUpload,
  type ImportProjectOptions,
  type RebuildImportOptions,
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
  DIVISION_LADDER,
  LADDER_OVERFLOW_TAG,
  PRETEXT_DIVISION_TAGS,
  PRETEXT_ROOT_TAGS,
  filePrefixForDivision,
  isDivisionTag,
  ladderDepth,
  shiftLadderTag,
  type LadderTag,
  type PretextDivisionTag,
  type PretextRootTag,
} from "./lib/pretext-divisions";
export {
  firstDivisionTag,
  isInlineContext,
  placeConvertedMarkup,
  reindentForContext,
  type PlacedMarkup,
  type PlacementContext,
} from "./lib/paste/place-markup";
export {
  outlineDivisions,
  pruneDivisions,
  type DivisionOutlineItem,
  type DivisionPath,
  type PruneDivisionsResult,
} from "./lib/select/divisions";
export {
  retargetFragment,
  retargetFragmentToDepth,
  dedupeXmlIds,
  prepareInsertSource,
  PROJECT_DESTINATION,
  type ImportDestination,
  type ProjectDestination,
  type InsertDestination,
  type PreparedInsertSource,
  type RetargetFragmentResult,
  type DedupeXmlIdsOptions,
  type DedupeXmlIdsResult,
  type IdRenameContext,
  type XmlIdRename,
} from "./lib/insert";
export {
  DEFAULT_IMPORT_MODE,
  filesForImportMode,
  assetsForImportMode,
  hasNativeImportMode,
  projectForImportMode,
  resolveImportMode,
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
  serializeProjectToRecords,
  serializeInsertToRecords,
  serializeProjectToPlusPayload,
  recordsToPlusPayload,
  serializeInsertFiles,
  serializeForDestination,
  divisionChildRefs,
} from "./lib/pool";
export type {
  BuildDivisionPoolOptions,
  BuildDivisionPoolResult,
  BuildNativeDivisionPoolOptions,
  SerializeProjectFilesOptions,
  SerializedProjectFiles,
  SerializeInsertOptions,
  SerializedInsert,
  SerializedInsertRecords,
  SerializeForDestinationOptions,
  SerializedForDestination,
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
  ProjectRecords,
  DivisionRecord,
  AssetRecord,
  PlusProjectPayload,
  PlusDivisionAttributes,
  PlusAssetAttributes,
  PlusAssetFile,
  ImportedProjectResult,
  ImportedProjectSuccess,
  ImportedProjectError,
  InsertRecord,
} from "./lib/types";
export {
  createWorkerEngine,
  runConversionInWorker,
  ConversionCancelledError,
  type ConversionWorker,
  type WorkerEngineOptions,
  type RunningConversion,
} from "./worker/worker-engine";
export type {
  WorkerRequest,
  WorkerResponse,
  ConvertRequest,
  ResultResponse,
  ErrorResponse,
} from "./worker/protocol";
export {
  PANDOC_ACCEPT_EXTENSIONS,
  PANDOC_BINARY_FORMATS,
  PANDOC_EXTENSION_FORMATS,
  fileExtension,
  pandocFormatForFileName,
  createPandocEngine,
  createRemotePandocEngine,
  describeRemotePandocFailure,
  extractPandocErrorDetail,
  DEFAULT_REMOTE_PANDOC_TIMEOUT_MS,
  type PandocInputFormat,
  type PandocBridge,
  type PandocEngineOptions,
  type RemotePandocEngineOptions,
} from "./lib/pandoc";
export {
  DEFAULT_ACCEPT_EXTENSIONS,
  allAcceptExtensions,
  alternateEngine,
  alternateFor,
  engineAccepts,
  engineExtensions,
  matchesExtension,
  routeEngine,
  unsupportedFileMessage,
  type RoutableEngine,
} from "./lib/engine-routing";
