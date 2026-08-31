// Assigning a file to every division in the pool.
//
// Shared by both destinations (SPEC §9.2): a new project hangs its divisions
// off `source/main.ptx`, an insert hangs them off whatever file receives the
// include, but the tree beneath is built the same way — each division's
// children live in a directory named after it, recursing for as many levels as
// the pool was split into.

import { slugify } from "../layout/shared";
import {
  filePrefixForDivision,
  isSingletonDivision,
} from "../pretext-divisions";
import type { ImportedDivision, ImportedProject } from "../types";
import { divisionChildRefs } from "./placeholders";

export interface PlacedDivision {
  division: ImportedDivision;
  filePath: string;
}

export interface PlacementResult {
  placed: PlacedDivision[];
  /** Href for each division's file, relative to the including file. */
  hrefByRef: Map<string, string>;
}

export interface PlaceDivisionsOptions {
  /** Divisions to place directly in `directory`, in document order. */
  entries: ImportedDivision[];
  /** Directory the entries land in, with a trailing slash (`""` for the root). */
  directory: string;
  /** xml:id the entries hang off, used to trim redundant filename prefixes. */
  parentXmlId: string;
}

/** Type-prefixed slug of a division's xmlId, for its filename (`ch-intro`). */
function prefixedSlug(xmlId: string, prefix: string): string {
  const cleaned = slugify(xmlId) || "division";
  return cleaned.startsWith(`${prefix}-`) ? cleaned : `${prefix}-${cleaned}`;
}

/** Deduplicate a name against those already taken (`-2`, `-3`, … suffixes). */
function claimName(taken: Set<string>, preferred: string): string {
  let candidate = preferred;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${preferred}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * A section generated inside chapter `ch-01` gets an xmlId like
 * `ch-01-sec-02`; its file lives in that chapter's directory already, so the
 * chapter prefix would be redundant in the filename.
 */
function childFileBasis(childXmlId: string, parentXmlId: string): string {
  const prefix = `${parentXmlId}-`;
  return childXmlId.startsWith(prefix)
    ? childXmlId.slice(prefix.length)
    : childXmlId;
}

/**
 * Walk the pool from `entries`, giving every division reachable from them a
 * file. Divisions reachable from no placeholder at all — the multi-root case
 * (SPEC §3.3/§4.1) — are placed alongside the entries afterwards, so nothing
 * silently disappears; they just aren't included anywhere.
 */
export function placeDivisions(
  project: ImportedProject,
  options: PlaceDivisionsOptions,
): PlacementResult {
  const byRef = new Map<string, ImportedDivision>(
    project.divisions.map((d) => [d.xmlId, d]),
  );

  const placed: PlacedDivision[] = [];
  const placedIds = new Set<string>();
  const hrefByRef = new Map<string, string>();
  // Filenames only have to be unique within their own directory.
  const takenByDirectory = new Map<string, Set<string>>();

  function claimInDirectory(directory: string, preferred: string): string {
    let taken = takenByDirectory.get(directory);
    if (!taken) {
      taken = new Set<string>();
      takenByDirectory.set(directory, taken);
    }
    return claimName(taken, preferred);
  }

  function place(
    division: ImportedDivision,
    directory: string,
    hrefPrefix: string,
    parentXmlId: string,
  ): void {
    if (placedIds.has(division.xmlId)) {
      return;
    }
    placedIds.add(division.xmlId);

    const slug = claimInDirectory(
      directory,
      isSingletonDivision(division.type)
        ? division.type
        : prefixedSlug(
            childFileBasis(division.xmlId, parentXmlId),
            filePrefixForDivision(division.type),
          ),
    );
    hrefByRef.set(division.xmlId, `${hrefPrefix}${slug}.ptx`);
    placed.push({ division, filePath: `${directory}${slug}.ptx` });

    for (const childRef of divisionChildRefs(division.content)) {
      const child = byRef.get(childRef);
      if (child) {
        place(child, `${directory}${slug}/`, `${slug}/`, division.xmlId);
      }
    }
  }

  for (const entry of options.entries) {
    place(entry, options.directory, "", options.parentXmlId);
  }

  const referenced = new Set<string>();
  for (const division of project.divisions) {
    for (const childRef of divisionChildRefs(division.content)) {
      referenced.add(childRef);
    }
  }
  for (const division of project.divisions) {
    if (
      division.isRoot ||
      placedIds.has(division.xmlId) ||
      referenced.has(division.xmlId)
    ) {
      continue;
    }
    place(division, options.directory, "", options.parentXmlId);
  }

  return { placed, hrefByRef };
}
