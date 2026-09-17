import { formatPretext } from "@pretextbook/format";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { cleanLatexInChunks, type CleanedChunk } from "./clean/clean-chunks";
import {
  splitLatexAtDocument,
  extractPreambleInfo,
  isBeamerClass,
  type PreambleInfo,
} from "./clean/latex-preamble";
import type { CleaningWarning } from "./clean/warnings";
import { detectSourceFormat } from "./detect-source-format";
import type { DocumentKind } from "./layout/document-kind";
import type { PretextRootTag } from "./pretext-divisions";
import type { ConvertedPretextResult, SourceFormat } from "./types";

function asConvertedString(converted: unknown): string {
  if (typeof converted === "string") {
    return converted;
  }

  if (
    typeof converted === "object" &&
    converted !== null &&
    "value" in converted
  ) {
    const value = (converted as { value?: unknown }).value;
    if (typeof value === "string") {
      return value;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  return String(converted);
}

// ---------------------------------------------------------------------------
// Preamble → PreTeXt assembly helpers
// ---------------------------------------------------------------------------

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Best-effort conversion of a LaTeX text snippet to plain text suitable for
 * embedding in an XML attribute or element. Strips common formatting macros
 * while preserving the readable content.
 */
function latexToPlainText(tex: string): string {
  return tex
    .replace(/\\LaTeX\b/g, "LaTeX")
    .replace(/\\TeX\b/g, "TeX")
    .replace(/\\thanks\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g, "")
    .replace(/\\inst\{[^{}]*\}/g, "")
    .replace(/\\email\{[^{}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1") // \cmd{content} → content
    .replace(/\\\s/g, " ")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDocinfo(info: PreambleInfo): string {
  const parts: string[] = [];

  if (info.macros) {
    const indented = xmlEscape(info.macros)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    parts.push(`  <macros>\n${indented}\n  </macros>`);
  }

  if (info.author) {
    // Take only the first author (split on \and)
    const firstAuthor = info.author.split(/\s+\\and\s+/)[0].trim();
    const name = xmlEscape(latexToPlainText(firstAuthor));
    if (name) {
      parts.push(
        `  <author>\n    <personname>${name}</personname>\n  </author>`,
      );
    }
  }

  if (parts.length === 0) return "";
  return `<docinfo>\n${parts.join("\n")}\n</docinfo>`;
}

/**
 * The PreTeXt root a converted LaTeX document belongs in.
 *
 * `unified-latex-to-pretext` already turns `\begin{frame}` into `<slide>`, and
 * `<slide>` is legal only inside `<slideshow>` — so a document that produced
 * one has told us what it is, whatever its `\documentclass` claimed. The class
 * is consulted second, for a beamer file whose frames all came out empty.
 */
function latexRootTag(content: string, info: PreambleInfo): PretextRootTag {
  if (/<slide[\s/>]/.test(content) || isBeamerClass(info.documentClass)) {
    return "slideshow";
  }
  return /<chapter[\s>]/.test(content) ? "book" : "article";
}

/**
 * Wraps the raw PreTeXt fragment produced by unified-latex into a properly
 * structured document: `<pretext><docinfo>…</docinfo><article|book>…</article|book></pretext>`.
 *
 * Also strips the empty `<p />` that unified-latex emits for `\maketitle`.
 */
function assemblePretextDocument(fragment: string, info: PreambleInfo): string {
  // Strip <p /> / <p></p> artifacts emitted for \maketitle
  const content = fragment
    .replace(/^\s*<p\s*\/>\s*/g, "")
    .replace(/^\s*<p>\s*<\/p>\s*/g, "")
    .trim();

  if (!content) return "";

  const docTag = latexRootTag(content, info);

  const docinfo = buildDocinfo(info);
  const titleEl = info.title
    ? `  <title>${xmlEscape(latexToPlainText(info.title))}</title>\n`
    : "";

  const docBody = `<${docTag}>\n${titleEl}${content}\n</${docTag}>`;
  const inner = [docinfo, docBody].filter(Boolean).join("\n");
  return `<pretext>\n${inner}\n</pretext>`;
}

export function normalizePretextSource(pretextSource: string): string {
  const trimmedPretext = pretextSource.trim();
  if (!trimmedPretext) {
    return "";
  }
  return formatPretext(trimmedPretext);
}

export interface LatexConversionResult {
  pretext: string;
  cleanedLatex: string;
  warnings: CleaningWarning[];
  /**
   * The cleaned source cut at its division headers, each piece carrying its own
   * before/after text. The wizard's per-file diff reads these; see
   * `clean-chunks.ts` for why cleaning is partitioned rather than global.
   */
  cleanChunks: CleanedChunk[];
}

export function convertLatexToPretext(
  latexSource: string,
): LatexConversionResult {
  const trimmedLatex = latexSource.trim();
  if (!trimmedLatex) {
    return { pretext: "", cleanedLatex: "", warnings: [], cleanChunks: [] };
  }

  // Extract preamble metadata from the raw source before any cleaning so
  // that comment deletion and macro substitution don't interfere.
  const { preamble, body } = splitLatexAtDocument(trimmedLatex);
  const { info: preambleInfo, warnings: preambleWarnings } =
    extractPreambleInfo(preamble);

  // Build a minimal source for unified-latex: \documentclass is required for
  // it to recognise the preamble/body boundary. Only macro definitions go in
  // the preamble (so they're registered without appearing in output). The raw
  // body follows inside \begin{document}...\end{document}.
  const conversionSource = body
    ? [
        `\\documentclass{${preambleInfo.documentClass}}`,
        preambleInfo.macros,
        "\\begin{document}",
        body,
        "\\end{document}",
      ]
        .filter(Boolean)
        .join("\n")
    : trimmedLatex; // no \begin{document} found — convert as-is

  const {
    output: cleanedLatex,
    warnings: chunkWarnings,
    chunks: cleanChunks,
  } = cleanLatexInChunks(conversionSource);
  const warnings = [...preambleWarnings, ...chunkWarnings];
  if (!cleanedLatex.trim()) {
    return { pretext: "", cleanedLatex, warnings, cleanChunks };
  }

  // trimJunk strips \end{document} but unified-latex needs it to recognise the
  // preamble/body boundary. Re-append it when we built a full document source.
  const sourceForUnified = body
    ? cleanedLatex + "\n\\end{document}"
    : cleanedLatex;

  const rawFragment = asConvertedString(
    latexToPretext(sourceForUnified),
  ).trim();
  if (!rawFragment) {
    return { pretext: "", cleanedLatex, warnings, cleanChunks };
  }

  const assembled = assemblePretextDocument(rawFragment, preambleInfo);
  const pretext = assembled ? normalizePretextSource(assembled) : "";
  return { pretext, cleanedLatex, warnings, cleanChunks };
}

export interface MarkdownConversionResult {
  pretext: string;
  cleanedMarkdown: string;
}

/**
 * Convert Markdown to PreTeXt.
 *
 * `documentRoot` names the root to wrap the document in, which for Markdown is
 * not cosmetic: it selects the heading hierarchy. Under `slideshow`, `#` is a
 * `<section>` and `##` a `<slide>` (`SLIDESHOW_HIERARCHY` in `@pretextbook/ptxast`),
 * not the `section`/`subsection` chain. Left undefined, the markdown's own
 * `division:` frontmatter decides — so an author who wrote `division: slideshow`
 * gets a deck without touching the wizard.
 */
export function convertMarkdownToPretext(
  markdownSource: string,
  documentRoot?: PretextRootTag,
): MarkdownConversionResult {
  const trimmedMarkdown = markdownSource.trim();
  if (!trimmedMarkdown) {
    return { pretext: "", cleanedMarkdown: "" };
  }

  const converted = String(
    markdownToPretext(
      trimmedMarkdown,
      documentRoot ? { documentRoot } : undefined,
    ),
  ).trim();
  const pretext = converted ? normalizePretextSource(converted) : "";
  return { pretext, cleanedMarkdown: trimmedMarkdown };
}

export function getConversionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Could not convert source content to PreTeXt.";
}

/**
 * `documentKind` is the user's explicit choice from the wizard, or `undefined`
 * for "auto detect". It reaches conversion — rather than only the layout stage,
 * where the rest of the pipeline resolves it — because Markdown's heading
 * hierarchy depends on the root: by the time layout runs, `##` has already
 * become a `<subsection>` and there is no slide left to recover.
 */
export function convertSourceToPretext(
  source: string,
  sourceFormat?: SourceFormat,
  documentKind?: DocumentKind,
): ConvertedPretextResult {
  const detectedSourceFormat = detectSourceFormat(source);
  const finalSourceFormat = sourceFormat ?? detectedSourceFormat;

  try {
    if (finalSourceFormat === "pretext") {
      return {
        sourceFormat: finalSourceFormat,
        detectedSourceFormat,
        pretextSource: normalizePretextSource(source),
        warnings: [],
      };
    }

    if (finalSourceFormat === "markdown") {
      const { pretext, cleanedMarkdown } = convertMarkdownToPretext(
        source,
        documentKind,
      );
      return {
        sourceFormat: finalSourceFormat,
        detectedSourceFormat,
        pretextSource: pretext,
        cleanedNativeSource: cleanedMarkdown,
        warnings: [],
      };
    }

    const { pretext, cleanedLatex, warnings, cleanChunks } =
      convertLatexToPretext(source);
    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextSource: pretext,
      cleanedNativeSource: cleanedLatex,
      warnings,
      cleanChunks,
    };
  } catch (error) {
    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextError: getConversionErrorMessage(error),
      warnings: [],
    };
  }
}
