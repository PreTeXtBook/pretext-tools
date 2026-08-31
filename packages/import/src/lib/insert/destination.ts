// Where an import is going (SPEC §9.2).
//
// New-project import and insert-into-existing-project share every stage of the
// pipeline up to the division pool: extraction, root selection, attachment,
// cleaning, split-depth resolution. They diverge only over the pool — what the
// fragment's levels mean, which ids it may use, and how the result is written
// out. `ImportDestination` is what carries that divergence, so insertion is a
// branch rather than a second pipeline.

import type { PretextDivisionTag } from "../pretext-divisions";

/** Import as a project of its own — scaffold, manifest, publication file. */
export interface ProjectDestination {
  kind: "project";
}

/** Import into a document that already exists. */
export interface InsertDestination {
  kind: "insert";
  /** Division level the imported document becomes (`subsection`, …). */
  targetTag: PretextDivisionTag;
  /** Every `xml:id` already live in the host project. */
  takenIds: ReadonlySet<string>;
  /**
   * Directory of the file receiving the include, with a trailing slash (`""`
   * for the workspace root). New files land beside it, so the hrefs written
   * into the parent are bare filenames.
   */
  hrefBase: string;
}

export type ImportDestination = ProjectDestination | InsertDestination;

export const PROJECT_DESTINATION: ProjectDestination = { kind: "project" };
