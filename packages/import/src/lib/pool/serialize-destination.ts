// The seam where the destination enters (SPEC §9.2).
//
// One call site, two projections: a new project with its scaffold, or an
// insertion into a project that already exists. Everything upstream — root
// selection, attachment, cleaning, split-depth resolution, and the pool itself
// — is destination-blind, which is what keeps insertion a branch rather than a
// second pipeline.

import type { ImportDestination } from "../insert/destination";
import type { ImportedProject } from "../types";
import {
  serializeProjectToFiles,
  type SerializeProjectFilesOptions,
} from "./serialize-files";
import { serializeInsertFiles } from "./serialize-insert";

export interface SerializeForDestinationOptions {
  /** Scaffolding paths; the `project` destination only. */
  layout?: SerializeProjectFilesOptions;
  /**
   * Whether to drop the document wrapper in favour of its children; the
   * `insert` destination only. Comes from `prepareInsertSource`, which decides
   * it before the pool is built.
   */
  unwrapRoot?: boolean;
}

export interface SerializedForDestination {
  files: Record<string, string>;
  /**
   * `<xi:include>` elements for the host to splice into the file at the
   * cursor. Always empty for the `project` destination, which writes its own
   * includes into the main file instead.
   */
  includes: string[];
  pathByRef: Record<string, string>;
}

export function serializeForDestination(
  project: ImportedProject,
  destination: ImportDestination,
  options: SerializeForDestinationOptions = {},
): SerializedForDestination {
  if (destination.kind === "insert") {
    return serializeInsertFiles(project, {
      targetTag: destination.targetTag,
      hrefBase: destination.hrefBase,
      unwrapRoot: options.unwrapRoot ?? false,
    });
  }
  const { files, pathByRef } = serializeProjectToFiles(project, options.layout);
  return { files, includes: [], pathByRef };
}
