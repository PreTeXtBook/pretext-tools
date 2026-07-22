// Ref (xml:id) allocation shared by the division-pool builders. Both the
// pretext builder (division-pool.ts) and the native latex/markdown builder
// (native-pool.ts) need the same rules: coerce a candidate id into a
// REF_REGEX-safe slug, deduplicate against everything already handed out, and
// record a warning whenever the id had to be renamed or generated.

import type { CleaningWarning } from "../clean/warnings";
import type { ImportedAsset } from "../types";

// pretext-plus's REF_REGEX for division/asset refs (also a valid NCName).
const REF_REGEX = /^[a-zA-Z_][a-zA-Z0-9\-_]*$/;

/**
 * Coerce a string into a REF_REGEX-safe ref: invalid characters collapse to
 * `-`, leading characters that can't start a ref are stripped. Returns `""`
 * when nothing valid remains.
 */
export function sanitizeRef(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9\-_]+/g, "-")
    .replace(/^[^a-zA-Z_]+/, "")
    .replace(/-+$/, "");
}

/** Hands out refs, deduplicating with `-2`, `-3`, … suffixes. */
export class RefPool {
  private used = new Set<string>();

  claim(preferred: string): string {
    let candidate = preferred;
    let n = 2;
    while (this.used.has(candidate)) {
      candidate = `${preferred}-${n}`;
      n += 1;
    }
    this.used.add(candidate);
    return candidate;
  }

  has(ref: string): boolean {
    return this.used.has(ref);
  }
}

export interface ClaimRefResult {
  ref: string;
  renamedFrom?: string;
  generated: boolean;
}

/**
 * Decide a division's ref from a raw id (an `xml:id`, a `\label`, or nothing):
 * the existing id when REF_REGEX-safe and unused, a sanitized/deduplicated
 * variant when not (reported as a rename), or a generated `fallback` when
 * there was no id at all.
 */
export function claimRefFromId(
  rawId: string | undefined,
  refs: RefPool,
  fallback: string,
): ClaimRefResult {
  if (rawId) {
    const sanitized = sanitizeRef(rawId) || fallback;
    const ref = refs.claim(sanitized);
    if (ref !== rawId) {
      return { ref, renamedFrom: rawId, generated: false };
    }
    return { ref, generated: false };
  }
  return { ref: refs.claim(fallback), generated: true };
}

/**
 * Record the structural warning implied by a ref claim: a rename when the
 * original id was invalid or collided, an info note when an id was generated.
 * `elementName` is the division's type (e.g. `chapter`); `position` is its
 * 1-based index among its siblings, for the generated-id message.
 */
export function pushRefWarnings(
  warnings: CleaningWarning[],
  claim: ClaimRefResult,
  elementName: string,
  position: number,
): void {
  if (claim.renamedFrom !== undefined) {
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "renamed_xml_id",
      macro: elementName,
      occurrences: 1,
      message: `${elementName} id \`${claim.renamedFrom}\` is not a valid ref (or collides with another); renamed to \`${claim.ref}\`. Cross-references to the old id will break.`,
    });
  } else if (claim.generated) {
    warnings.push({
      action: "anomaly",
      severity: "info",
      kind: "structure",
      category: "missing_xml_id",
      macro: elementName,
      occurrences: 1,
      message: `${elementName} at position ${position} has no id; assigned \`${claim.ref}\`.`,
    });
  }
}

/**
 * Turn a map of raw asset bytes (keyed by original input path) into
 * `ImportedAsset` records, minting a ref from each basename's stem and
 * deduplicating against everything already claimed (divisions included).
 */
export function buildAssets(
  rawAssets: Record<string, Uint8Array>,
  refs: RefPool,
): ImportedAsset[] {
  return Object.entries(rawAssets).map(([originalPath, data]) => {
    const fileName = originalPath.split("/").pop() ?? originalPath;
    const stem = fileName.replace(/\.[^.]+$/, "");
    const ref = refs.claim(sanitizeRef(stem) || "asset");
    return { ref, fileName, data };
  });
}
