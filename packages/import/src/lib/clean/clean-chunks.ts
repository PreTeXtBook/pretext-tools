// Cleaning, but partitioned at division boundaries.
//
// The wizard's per-file diff needs a before/after pair for each generated file.
// Cleaning the whole document at once cannot give that: cleaning happens in
// LaTeX coordinates and files are cut in PreTeXt coordinates, and nothing maps
// offsets across the unified-latex conversion between them.
//
// Cutting the source at its division headers first and cleaning each piece
// separately dissolves the problem — a fix is in the chunk it was handed. The
// pieces are rejoined before conversion, so unified-latex still sees one
// document and preamble macro scope is untouched.

import {
  cleanLatexText,
  findDocumentRegions,
  type LatexFix,
} from "@pretextbook/latex-style-pretext";
import { findLatexHeaders, latexDivisionHierarchy } from "../latex-split";
import { fixesToWarnings } from "./clean-latex";
import { trimJunk } from "./latex-utils";
import type { CleaningWarning } from "./warnings";

export interface CleanedChunk {
  /**
   * Heading path from the document root — `["Limits", "One-sided limits"]`.
   * Empty for the preamble and for body text ahead of the first heading.
   */
  path: string[];
  /** The chunk's own heading, or `""` when it has none. */
  title: string;
  /** `"preamble"`, a LaTeX sectioning command, or `null` for the lead-in text. */
  kind: "preamble" | "lead" | "division";
  /** Sectioning command that opened this chunk, when `kind` is `"division"`. */
  command?: string;
  /** Depth in the document's own hierarchy; 0 for preamble and lead-in. */
  level: number;
  before: string;
  after: string;
  fixes: LatexFix[];
}

export interface CleanLatexChunksResult {
  /** The cleaned document, chunks rejoined in source order. */
  output: string;
  chunks: CleanedChunk[];
  /** Aggregate over every chunk — the document-level summary. */
  warnings: CleaningWarning[];
  fixes: LatexFix[];
}

/**
 * Clean `source`, cutting it at every division header so each piece carries its
 * own before/after text and fix list.
 *
 * Chunks are cut at the *deepest* level the document has, not at a requested
 * split depth. A shallower view is a matter of concatenating consecutive chunks
 * (`mergeChunksAtLevel`), which lets the wizard change split depth without
 * re-cleaning or re-converting anything.
 */
export function cleanLatexInChunks(source: string): CleanLatexChunksResult {
  const text = trimJunk(source).replace(/(\n *){3,}/g, "\n\n");
  const regions = findDocumentRegions(text, "auto");
  const chunks: CleanedChunk[] = [];

  const preambleText = text.slice(regions.preamble.start, regions.preamble.end);
  if (preambleText) {
    chunks.push(
      cleanChunk(
        preambleText,
        {
          path: [],
          title: "",
          kind: "preamble",
          level: 0,
        },
        "preamble",
      ),
    );
  }

  const body = text.slice(regions.body.start, regions.body.end);
  chunks.push(...cleanBodyChunks(body));

  // The bibliography is hand-formatted data; no rule may touch it, so it is
  // carried through verbatim rather than cleaned as a chunk.
  const bibliography = regions.bibliography
    ? text.slice(regions.bibliography.start, regions.bibliography.end)
    : "";

  // Checked against the text, not against the preamble span: a document whose
  // `\begin{document}` is the very first thing has an empty preamble, which is
  // not the same as having no `\begin{document}` at all.
  const hasDocument = text.includes("\\begin{document}");
  const cleanedBody = chunks
    .filter((chunk) => chunk.kind !== "preamble")
    .map((chunk) => chunk.after)
    .join("");
  const cleanedPreamble =
    chunks.find((c) => c.kind === "preamble")?.after ?? "";

  const output = (
    (hasDocument ? cleanedPreamble + "\\begin{document}" : "") +
    cleanedBody +
    bibliography
  ).replace(/(\n *){3,}/g, "\n\n");

  const fixes = chunks.flatMap((chunk) => chunk.fixes);
  return { output, chunks, warnings: fixesToWarnings(fixes), fixes };
}

function cleanChunk(
  before: string,
  meta: Omit<CleanedChunk, "before" | "after" | "fixes">,
  scope: "preamble" | "body",
): CleanedChunk {
  const { output, fixes } = cleanLatexText(before, { scope });
  return { ...meta, before, after: output, fixes };
}

/**
 * Partition a document body at every sectioning header and clean each piece.
 *
 * A flat partition, not a tree walk: chunk boundaries are exactly the header
 * offsets, so concatenating every chunk's `before` reproduces the body byte for
 * byte, and concatenating every `after` gives the cleaned body.
 */
function cleanBodyChunks(body: string): CleanedChunk[] {
  const headers = findLatexHeaders(body);
  const hierarchy = latexDivisionHierarchy(body);
  const levelOf = new Map(hierarchy.map((cmd, index) => [cmd, index + 1]));

  if (headers.length === 0) {
    return body
      ? [
          cleanChunk(
            body,
            { path: [], title: "", kind: "lead", level: 0 },
            "body",
          ),
        ]
      : [];
  }

  const chunks: CleanedChunk[] = [];

  // Text ahead of the first heading is its own chunk only when it is real
  // content. The usual case is the newline after `\begin{document}`, which
  // would otherwise show up in the wizard as an empty file; it rides along on
  // the first division instead, so reassembly stays exact either way.
  const lead = body.slice(0, headers[0].start);
  let carry = "";
  if (lead.trim()) {
    chunks.push(
      cleanChunk(lead, { path: [], title: "", kind: "lead", level: 0 }, "body"),
    );
  } else {
    carry = lead;
  }

  const stack: string[] = [];
  headers.forEach((header, index) => {
    const level = levelOf.get(header.command) ?? 1;
    const title = plainTitle(header.rawTitle);
    stack.length = level - 1;
    stack[level - 1] = title;

    const end = headers[index + 1]?.start ?? body.length;
    const text = (index === 0 ? carry : "") + body.slice(header.start, end);
    chunks.push(
      cleanChunk(
        text,
        {
          path: [...stack],
          title,
          kind: "division",
          command: header.command,
          level,
        },
        "body",
      ),
    );
  });

  return chunks;
}

function plainTitle(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapse chunks to the view a given split depth produces: one entry per file
 * that depth would generate, with the chunks below it concatenated in.
 *
 * `level` 0 gives a single entry for the whole body; 1 one per top-level
 * division; and so on. The preamble is always its own entry, since it never
 * becomes a file of its own.
 */
export function mergeChunksAtLevel(
  chunks: CleanedChunk[],
  level: number,
): CleanedChunk[] {
  const merged: CleanedChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.kind === "preamble") {
      merged.push(chunk);
      continue;
    }

    const opensNewFile =
      chunk.kind === "division" && chunk.level <= level && level > 0;
    const previous = merged[merged.length - 1];
    const canAppend =
      previous !== undefined && previous.kind !== "preamble" && !opensNewFile;

    if (canAppend) {
      merged[merged.length - 1] = {
        ...previous,
        before: previous.before + chunk.before,
        after: previous.after + chunk.after,
        fixes: [...previous.fixes, ...chunk.fixes],
      };
      continue;
    }

    merged.push({ ...chunk, path: chunk.path.slice(0, Math.max(level, 0)) });
  }

  return merged;
}
