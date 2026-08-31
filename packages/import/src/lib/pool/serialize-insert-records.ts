// The record projection of an insert (SPEC §9.4): what a host that stores
// divisions rather than files receives when an import goes into a project it
// already holds.
//
// Insertion needs no new projection here, only a different edge. A file host
// has to place files and rewrite placeholders into `<xi:include href="…"/>`;
// a record host stores the pool as it is, placeholders included, and the only
// question is which records are new and what to splice into the parent
// division's source. `hrefBase` is meaningless in this world and unused.

import type { AssetRecord, DivisionRecord, ImportedProject } from "../types";
import { assetToRecord, divisionToRecord } from "./serialize-records";
import { insertEntries, type SerializeInsertOptions } from "./serialize-insert";

export interface SerializedInsertRecords {
  /** New division rows, the inserted units first. */
  divisions: DivisionRecord[];
  assets: AssetRecord[];
  /**
   * `<plus:TYPE ref="…"/>` elements for the host to write into the source of
   * the division receiving the insert — the record-world counterpart of the
   * `<xi:include>` a file host splices into the parent file.
   */
  placeholders: string[];
}

/**
 * Serialize an insert as records.
 *
 * Every division in the pool belongs to the import — the pool is built from the
 * pruned, prepared source and holds nothing else — so the only division that
 * can be left out is the document wrapper, when it was dropped in favour of its
 * children.
 */
export function serializeInsertToRecords(
  project: ImportedProject,
  options: Pick<SerializeInsertOptions, "targetTag" | "unwrapRoot">,
): SerializedInsertRecords {
  const { root, entries } = insertEntries(project, options);
  const entryRefs = new Set(entries.map((entry) => entry.xmlId));

  const rest = project.divisions.filter(
    (division) =>
      !entryRefs.has(division.xmlId) &&
      !(options.unwrapRoot && division.xmlId === root.xmlId),
  );

  return {
    divisions: [...entries, ...rest].map(divisionToRecord),
    assets: project.assets.map(assetToRecord),
    placeholders: entries.map(
      (entry) => `<plus:${entry.type} ref="${entry.xmlId}"/>`,
    ),
  };
}
