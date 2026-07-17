/**
 * Pure parser for the PreTeXt document outline.
 *
 * Extracted from `documentOutline.ts` so the (fiddly, regex-based) parsing of a
 * possibly-malformed document can be unit tested without the `vscode` API. The
 * TreeDataProvider in `documentOutline.ts` wraps each `OutlineItem` in a
 * `vscode`-aware `OutlineNode` (attaching the document `Uri`).
 *
 * The parser is intentionally tolerant of incomplete/invalid XML — the user is
 * typically editing the file as it runs — so it uses a line-by-line regex scan
 * rather than a real XML parser.
 */

/** Maps PreTeXt element tags to display icons and labels. */
export const ELEMENT_CONFIG: Record<string, { icon: string; label: string }> = {
  book: { icon: "book", label: "Book" },
  article: { icon: "book", label: "Article" },
  frontmatter: { icon: "info", label: "Front Matter" },
  backmatter: { icon: "info", label: "Back Matter" },
  part: { icon: "symbol-namespace", label: "Part" },
  chapter: { icon: "symbol-class", label: "Chapter" },
  section: { icon: "symbol-class", label: "Section" },
  subsection: { icon: "symbol-method", label: "Subsection" },
  subsubsection: { icon: "symbol-field", label: "Subsubsection" },
  paragraphs: { icon: "symbol-text", label: "Paragraphs" },
  appendix: { icon: "symbol-class", label: "Appendix" },
  preface: { icon: "note", label: "Preface" },
  acknowledgement: { icon: "note", label: "Acknowledgement" },
  dedication: { icon: "heart", label: "Dedication" },
  colophon: { icon: "note", label: "Colophon" },
  biography: { icon: "person", label: "Biography" },
  worksheet: { icon: "checklist", label: "Worksheet" },
  exercises: { icon: "tasklist", label: "Exercises" },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- PreTeXt element name
  "reading-questions": { icon: "question", label: "Reading Questions" },
  solutions: { icon: "check-all", label: "Solutions" },
  glossary: { icon: "book", label: "Glossary" },
  subexercises: { icon: "tasklist", label: "Subexercises" },
  references: { icon: "references", label: "References" },
  index: { icon: "list-ordered", label: "Index" },
};

// Only these tags appear in the outline — section headings and structural containers.
export const OUTLINE_TAGS = new Set(Object.keys(ELEMENT_CONFIG));

// Tags that can contain other outline-relevant elements (pushed on the stack so
// following divisions nest beneath them). Specialized divisions such as
// `exercises`/`solutions` are included because they can hold their own
// substructure; treating a leaf division as a container is harmless.
export const CONTAINER_TAGS = new Set([
  "book",
  "article",
  "frontmatter",
  "backmatter",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "appendix",
  "preface",
  "worksheet",
  "exercises",
  "reading-questions",
  "subexercises",
  "solutions",
  "glossary",
]);

/** A plain (vscode-free) node in the parsed outline tree. */
export interface OutlineItem {
  tag: string;
  title: string;
  xmlId: string;
  line: number;
  character: number;
  children: OutlineItem[];
  /** For `xi:include` items only: the `href` of the referenced file. */
  href?: string;
}

/** Options controlling which tags {@link parseOutline} recognizes. */
export interface ParseOutlineOptions {
  /**
   * Also emit `<xi:include>` items (as leaves carrying their `href`) so a
   * project-wide outline can splice in the referenced files. Off by default,
   * so the single-file outline never shows include placeholders.
   */
  includeXInclude?: boolean;
}

const TAG_NAMES = [...OUTLINE_TAGS].join("|");
const XI_TAG_NAMES = `${TAG_NAMES}|xi:include`;

// One regex that matches an opening or closing outline tag; the (/?) group
// tells us which. The trailing (?=[\s>/]) ensures `<section>` does not also
// match `<sectionfoo>`. Global so we can walk every tag on a line in order.
// Two variants: divisions only (single-file outline), and divisions plus
// `xi:include` (project-wide outline).
const TAG_TOKEN = new RegExp(`<(\\/?)(${TAG_NAMES})(?=[\\s>/])`, "g");
const TAG_TOKEN_XI = new RegExp(`<(\\/?)(${XI_TAG_NAMES})(?=[\\s>/])`, "g");

// Matches only an opening outline tag; used to stop the title look-ahead at the
// next division so an untitled section can't steal the following section's title.
const TAG_OPEN = new RegExp(`<(${TAG_NAMES})(?=[\\s>/])`);
const TAG_OPEN_XI = new RegExp(`<(${XI_TAG_NAMES})(?=[\\s>/])`);

/**
 * Replace the contents of XML comments with spaces, preserving every character
 * position (offsets and line numbers stay valid because non-newline characters
 * become spaces). This lets the scan below ignore commented-out tags without
 * losing track of columns or dropping real content that shares a line with a
 * comment.
 */
export function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Parse a .ptx document's text into a tree of {@link OutlineItem}s.
 *
 * Every opening/closing tag is processed in textual order using a single global
 * regex, so multiple tags on one line — and closing tags before opening ones —
 * are handled correctly.
 */
export function parseOutline(
  text: string,
  opts: ParseOutlineOptions = {},
): OutlineItem[] {
  const tokenRe = opts.includeXInclude ? TAG_TOKEN_XI : TAG_TOKEN;
  const stopRe = opts.includeXInclude ? TAG_OPEN_XI : TAG_OPEN;

  const roots: OutlineItem[] = [];
  // Stack to track nesting: each entry is { tag, node }.
  const stack: Array<{ tag: string; node: OutlineItem }> = [];
  const lines = blankComments(text).split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    tokenRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(line))) {
      const [, slash, tag] = m;

      if (slash) {
        // Closing tag: pop to (and including) the matching open. If there is no
        // matching open on the stack (a stray close while the user is
        // mid-edit), leave the stack alone rather than emptying it.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }

      // Opening tag. Only look at THIS tag's own attributes.
      const attrText = line.slice(m.index).match(/^<[^>]*/)?.[0] ?? "";
      const xmlId = attrText.match(/xml:id=["']([^"']+)["']/)?.[1] ?? "";

      const node: OutlineItem = {
        tag,
        title: extractTitle(lines, lineNum, stopRe),
        xmlId,
        line: lineNum,
        character: m.index,
        children: [],
      };
      if (tag === "xi:include") {
        node.href = attrText.match(/href=["']([^"']+)["']/)?.[1] ?? "";
      }
      (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
      // `xi:include` is a leaf (never a container), so it attaches to the
      // enclosing division at the right position for later splicing.
      if (CONTAINER_TAGS.has(tag)) {
        stack.push({ tag, node });
      }
    }
  }

  return roots;
}

/**
 * Extract the text content of a `<title>...</title>` element starting from the
 * given line. Looks ahead up to 8 lines to handle multi-line titles, but stops
 * early at the next division tag so an untitled division does not absorb the
 * title of a following one.
 */
export function extractTitle(
  lines: string[],
  startLine: number,
  stopRe: RegExp = TAG_OPEN,
): string {
  let end = Math.min(startLine + 8, lines.length);
  for (let i = startLine + 1; i < end; i++) {
    if (stopRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  // The window still includes `startLine` itself, so `<section><title>T</title>`
  // on one line keeps working.
  const searchWindow = lines.slice(startLine, end).join("\n");

  const singleLine = searchWindow.match(/<title>(.*?)<\/title>/);
  if (singleLine) {
    return cleanText(singleLine[1]);
  }

  const multiLine = searchWindow.match(/<title>\s*([\s\S]*?)\s*<\/title>/);
  if (multiLine) {
    return cleanText(multiLine[1]);
  }

  return "";
}

/** Clean extracted text: strip XML tags, collapse whitespace. */
export function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
