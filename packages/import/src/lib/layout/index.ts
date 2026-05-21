export {
  buildPretextProjectFiles,
  type BuildProjectFilesOptions,
  type BuildProjectFilesResult,
} from "./build-project-files";
export { detectDocumentKind, type DocumentKind } from "./document-kind";
export {
  renderProjectPtx,
  renderPublicationPtx,
  renderXmlProlog,
} from "./templates";
export {
  findTopLevelElements,
  findFirstElement,
  type XmlElementSpan,
} from "./xml-scan";
