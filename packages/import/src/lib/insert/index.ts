// The "import into an existing project" branch (SPEC §9). Two pure transforms
// that make a fragment converted in isolation fit to join a host document, and
// the destination type that decides when they run. Nothing here knows about
// VS Code, pretext-plus, or the file system.

export {
  retargetFragment,
  retargetFragmentToDepth,
  type RetargetFragmentResult,
} from "./retarget";
export {
  dedupeXmlIds,
  type DedupeXmlIdsOptions,
  type DedupeXmlIdsResult,
  type IdRenameContext,
  type XmlIdRename,
} from "./dedupe-ids";
export {
  PROJECT_DESTINATION,
  type ImportDestination,
  type InsertDestination,
  type ProjectDestination,
} from "./destination";
export { prepareInsertSource, type PreparedInsertSource } from "./prepare";
