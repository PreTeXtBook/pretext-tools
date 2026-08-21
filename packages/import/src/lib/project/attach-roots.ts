// Combines a multi-root upload into one document.
//
// Uploads regularly contain several standalone files — a `\documentclass` per
// chapter is a common way to write a book in LaTeX, since each chapter then
// compiles on its own. The import picks one as the main document (see
// `analyze.ts`) and, by default, attaches the rest as divisions of it.
//
// Attachment happens *before* conversion, on the source text: the extra roots'
// bodies are spliced into the main document under a heading of the requested
// level. That way there is still exactly one conversion pass, macros defined
// in the main preamble are in scope for the attached content, and the division
// splitter downstream sees a perfectly ordinary single document.

import {
  extractLatexField,
  extractMacros,
  splitLatexAtDocument,
} from "../clean/latex-preamble";
import type { CleaningWarning } from "../clean/warnings";
import { stem } from "./paths";

/** Division level an extra root is attached at. */
export type AttachLevel = "chapter" | "section";

/** A caller's instruction for one extra root. */
export interface RootAttachment {
  /** Path of the extra root within the uploaded file set. */
  path: string;
  /** Level to attach at; defaults to the main document's own top level. */
  level?: AttachLevel;
  /** Heading text; defaults to the file's `\title`, else its filename. */
  title?: string;
  /** Set false to leave this root out of the import entirely. */
  include?: boolean;
}

export interface AttachedRootRecord {
  path: string;
  title: string;
  level: AttachLevel;
}

export interface AttachRootsResult {
  /** The combined source, ready for the normal conversion pipeline. */
  source: string;
  attached: AttachedRootRecord[];
  warnings: CleaningWarning[];
}

const BEGIN_DOCUMENT = "\\begin{document}";
const END_DOCUMENT = "\\end{document}";

/** Document classes whose top-level division is a chapter. */
const BOOK_CLASSES =
  /\\documentclass\s*(?:\[[^\]]*\])?\s*\{(book|report|memoir|scrbook|scrreprt|amsbook)\}/;

/** Turn `my-chapter_two.tex` into `My Chapter Two`. */
function titleFromFileName(path: string): string {
  return (
    stem(path)
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Untitled"
  );
}

function attachmentWarning(
  record: AttachedRootRecord,
  detail: string,
): CleaningWarning {
  return {
    action: "anomaly",
    severity: "info",
    kind: "structure",
    category: "attached_root",
    macro: record.level,
    occurrences: 1,
    message: detail,
  };
}

/**
 * The level extra roots attach at when the caller does not say: a chapter when
 * the main document is book-like, a section otherwise.
 */
export function defaultAttachLevel(mainSource: string): AttachLevel {
  const { preamble, body } = splitLatexAtDocument(mainSource);
  if (BOOK_CLASSES.test(preamble) || /\\chapter\b/.test(body)) {
    return "chapter";
  }
  return "section";
}

/** Does this body already open with its own heading at (or above) `level`? */
function opensWithHeading(body: string, level: AttachLevel): boolean {
  const withoutComments = body.replace(/^\s*(%[^\n]*\n\s*)*/, "");
  return level === "chapter"
    ? /^\\(chapter|part)\b/.test(withoutComments)
    : /^\\(section|chapter|part)\b/.test(withoutComments);
}

/**
 * Splice the extra LaTeX roots into the main document.
 *
 * Each attached file contributes its body (what lies between
 * `\begin{document}` and `\end{document}`, or the whole file when it declares
 * neither) plus any macro definitions from its preamble, which are hoisted
 * into the main preamble so the attached content's own commands still resolve.
 */
export function attachLatexRoots(
  mainSource: string,
  attachments: RootAttachment[],
  files: Record<string, string>,
): AttachRootsResult {
  const wanted = attachments.filter((a) => a.include !== false);
  if (wanted.length === 0) {
    return { source: mainSource, attached: [], warnings: [] };
  }

  const hasDocumentEnvironment = mainSource.includes(BEGIN_DOCUMENT);
  const { preamble, body } = splitLatexAtDocument(mainSource);
  const fallbackLevel = defaultAttachLevel(mainSource);

  const attached: AttachedRootRecord[] = [];
  const warnings: CleaningWarning[] = [];
  const hoistedMacros: string[] = [];
  const pieces: string[] = [];

  for (const attachment of wanted) {
    const contents = files[attachment.path];
    if (contents === undefined) {
      warnings.push({
        action: "anomaly",
        severity: "warning",
        kind: "structure",
        category: "attached_root_missing",
        macro: attachment.path,
        occurrences: 1,
        message: `Cannot attach \`${attachment.path}\`: it is not among the uploaded files.`,
      });
      continue;
    }

    const level = attachment.level ?? fallbackLevel;
    const title =
      attachment.title ||
      extractLatexField(contents, "title") ||
      titleFromFileName(attachment.path);
    const record: AttachedRootRecord = {
      path: attachment.path,
      title,
      level,
    };

    const split = splitLatexAtDocument(contents);
    const { macros, warnings: macroWarnings } = extractMacros(split.preamble);
    if (macros) {
      hoistedMacros.push(macros);
    }
    warnings.push(...macroWarnings);

    const attachedBody = split.body.trim();
    if (!attachedBody) {
      warnings.push(
        attachmentWarning(record, `\`${attachment.path}\` is empty; skipped.`),
      );
      continue;
    }

    // A file that already opens with its own heading supplies the division;
    // wrapping it again would bury its content one level too deep.
    pieces.push(
      opensWithHeading(attachedBody, level)
        ? attachedBody
        : `\\${level}{${title}}\n\n${attachedBody}`,
    );
    attached.push(record);
    warnings.push(
      attachmentWarning(
        record,
        `Attached \`${attachment.path}\` as a ${level}: “${title}”.`,
      ),
    );
  }

  if (pieces.length === 0) {
    return { source: mainSource, attached, warnings };
  }

  const combinedBody = [body.trim(), ...pieces].filter(Boolean).join("\n\n");
  if (!hasDocumentEnvironment) {
    return {
      source: [preamble, ...hoistedMacros, combinedBody]
        .filter(Boolean)
        .join("\n\n"),
      attached,
      warnings,
    };
  }

  const source = [
    [preamble, ...hoistedMacros].filter(Boolean).join("\n"),
    BEGIN_DOCUMENT,
    combinedBody,
    END_DOCUMENT,
  ].join("\n");

  return { source, attached, warnings };
}

/**
 * Markdown counterpart. Extra roots are appended under a depth-1 heading,
 * which `remark-pretext` maps to the document's top-level division — so this
 * currently only supports top-level attachment, not the chapter/section choice
 * the LaTeX path offers.
 */
export function attachMarkdownRoots(
  mainSource: string,
  attachments: RootAttachment[],
  files: Record<string, string>,
): AttachRootsResult {
  const wanted = attachments.filter((a) => a.include !== false);
  const attached: AttachedRootRecord[] = [];
  const warnings: CleaningWarning[] = [];
  const pieces: string[] = [];

  for (const attachment of wanted) {
    const contents = files[attachment.path];
    if (contents === undefined) {
      warnings.push({
        action: "anomaly",
        severity: "warning",
        kind: "structure",
        category: "attached_root_missing",
        macro: attachment.path,
        occurrences: 1,
        message: `Cannot attach \`${attachment.path}\`: it is not among the uploaded files.`,
      });
      continue;
    }

    const body = contents.trim();
    if (!body) {
      continue;
    }
    const headingMatch = /^#\s+(.+)$/m.exec(body);
    const title =
      attachment.title ||
      headingMatch?.[1]?.trim() ||
      titleFromFileName(attachment.path);
    const record: AttachedRootRecord = {
      path: attachment.path,
      title,
      level: attachment.level ?? "chapter",
    };

    pieces.push(body.startsWith("# ") ? body : `# ${title}\n\n${body}`);
    attached.push(record);
    warnings.push(
      attachmentWarning(record, `Attached \`${attachment.path}\`: “${title}”.`),
    );
  }

  if (pieces.length === 0) {
    return { source: mainSource, attached, warnings };
  }

  return {
    source: [mainSource.trim(), ...pieces].filter(Boolean).join("\n\n"),
    attached,
    warnings,
  };
}
