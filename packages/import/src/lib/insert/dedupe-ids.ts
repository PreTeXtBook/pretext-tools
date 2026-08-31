// Renaming an imported fragment's colliding `xml:id`s (SPEC §9.3).
//
// A fragment converted in isolation knows nothing about the document it is
// about to join. Its `xml:id`s are unique among themselves at best, and a
// second `xml:id="sec-intro"` in a project is not a cosmetic problem — it is
// invalid XML, and the build fails on it.
//
// Renaming is therefore mandatory, but it comes with an obligation: an
// `<xref ref="…">` inside the fragment pointing at a renamed id must follow it,
// or a fix for one broken document produces another. Everything the fragment
// says about itself stays internally consistent; only its outward-facing names
// change.
//
// The contract is whole-fragment and pre-split: a reference follows a rename
// only when the `xml:id` declaring it is in the same string. Run this (and
// `retargetFragment`) on the converted source *before* `buildDivisionPool`,
// where every id is still visible at once — once the pool has split the
// document, a child's id lives in its own record and a parent holding
// `<plus:subsection ref="…"/>` can no longer see what it names.

import { findTagOccurrences } from "../layout/xml-scan";
import { spliceReplacements } from "../layout/shared";
import { sanitizeRef } from "../pool/refs";

/**
 * Attributes whose value names one or more `xml:id`s. `ref` covers both
 * `<xref ref="…"/>` and the division pool's own `<plus:section ref="…"/>`
 * placeholders, which address divisions by exactly the same name; `first` and
 * `last` carry the endpoints of an `<xref>` range.
 */
const REFERENCE_ATTRIBUTES = ["ref", "first", "last"] as const;

export interface XmlIdRename {
  from: string;
  to: string;
}

export interface DedupeXmlIdsOptions {
  /** Every `xml:id` already live in the host project. */
  takenIds: ReadonlySet<string>;
  /**
   * Ref of the fragment's outermost division, when it has one — available to
   * the naming policy as a natural namespace for the ids beneath it.
   */
  fragmentRef?: string;
}

export interface DedupeXmlIdsResult {
  /** The fragment with colliding ids — and references to them — renamed. */
  source: string;
  /** Every rename performed, in document order, for the host to surface. */
  renamed: XmlIdRename[];
}

export interface IdRenameContext {
  /** The colliding id exactly as it appeared in the fragment. */
  original: string;
  /** `original` coerced into a valid ref; equal to `original` when it already was one. */
  base: string;
  /** True when a candidate name is spoken for — by the host, or by a rename already made. */
  isTaken: (candidate: string) => boolean;
  /** Ref of the fragment's outermost division, when known. */
  fragmentRef?: string;
}

/**
 * Choose the name a colliding `xml:id` gets: the numeric suffix `RefPool.claim`
 * hands out elsewhere in the pipeline, so an author meets one naming convention
 * across imports rather than two. Must return a valid ref that `ctx.isTaken`
 * rejects.
 */
function pickReplacementId(ctx: IdRenameContext): string {
  let candidate = ctx.base;
  let n = 2;
  while (ctx.isTaken(candidate) || candidate === "") {
    candidate = `${ctx.base || "id"}-${n}`;
    n += 1;
  }
  return candidate;
}

/** Split a reference attribute's value into names and the separators between them. */
function splitRefList(value: string): string[] {
  return value.split(/([\s,]+)/);
}

/**
 * Rename every `xml:id` in `source` that collides with the host project (or
 * with an earlier id in the fragment itself), rewriting internal references to
 * match. Ids that are unique and valid are left exactly as the author wrote
 * them — a rename an author did not ask for is a rename they have to undo.
 */
export function dedupeXmlIds(
  source: string,
  options: DedupeXmlIdsOptions,
): DedupeXmlIdsResult {
  const tags = findTagOccurrences(source);

  // Names already spoken for: the host's, plus everything this pass has
  // settled on — kept ids and renames alike, so two collisions never collide.
  const taken = new Set<string>(options.takenIds);
  const isTaken = (candidate: string) => taken.has(candidate);

  const renames = new Map<string, string>();
  const renamed: XmlIdRename[] = [];

  for (const tag of tags) {
    const id = tag.attributes["xml:id"];
    if (id === undefined || renames.has(id)) continue;

    const base = sanitizeRef(id);
    if (base === id && !taken.has(id)) {
      taken.add(id);
      continue;
    }

    const replacement = pickReplacementId({
      original: id,
      base,
      isTaken,
      fragmentRef: options.fragmentRef,
    });
    taken.add(replacement);
    renames.set(id, replacement);
    renamed.push({ from: id, to: replacement });
  }

  if (renames.size === 0) return { source, renamed: [] };

  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  for (const tag of tags) {
    const text = source.slice(tag.start, tag.end);
    let rewritten = text;

    const id = tag.attributes["xml:id"];
    const newId = id === undefined ? undefined : renames.get(id);
    if (newId !== undefined) {
      rewritten = rewritten.replace(
        /\bxml:id\s*=\s*(["'])[^"']*\1/,
        (_whole, quote: string) => `xml:id=${quote}${newId}${quote}`,
      );
    }

    for (const attr of REFERENCE_ATTRIBUTES) {
      const value = tag.attributes[attr];
      if (value === undefined) continue;
      const updated = splitRefList(value)
        .map((part) => renames.get(part) ?? part)
        .join("");
      if (updated === value) continue;
      rewritten = rewritten.replace(
        new RegExp(`\\b${attr}\\s*=\\s*(["'])[^"']*\\1`),
        (_whole, quote: string) => `${attr}=${quote}${updated}${quote}`,
      );
    }

    if (rewritten !== text) {
      replacements.push({
        start: tag.start,
        end: tag.end,
        replacement: rewritten,
      });
    }
  }

  return { source: spliceReplacements(source, replacements), renamed };
}
