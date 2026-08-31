// Where an imported file lands in the document the author is editing.
//
// The import package decides what the fragment becomes (packages/import/SPEC.md
// §9.3); this decides where in *this* document it goes and at what level, which
// is the one thing only the editor knows. Kept free of `vscode` so it can be
// unit-tested against plain text.

import {
  DIVISION_LADDER,
  isDivisionTag,
  ladderDepth,
  type PretextDivisionTag,
} from "@pretextbook/import";
import { isInlineContext } from "./paste-convert-core";
import { parseOutline, type OutlineItem } from "./outline-parser";

/**
 * The division level a child of each container takes.
 *
 * Containers absent from this table hold no divisions of their own — a
 * `<worksheet>` holds exercises, a `<subsubsection>` has no level below it — so
 * an insertion inside one attaches to its parent instead, landing beside it
 * rather than inside it.
 */
const CHILD_DIVISION: Record<string, PretextDivisionTag> = {
  book: "chapter",
  part: "chapter",
  chapter: "section",
  article: "section",
  section: "subsection",
  subsection: "subsubsection",
  // The natural thing to add to each end of a book, rather than a depth.
  frontmatter: "preface",
  backmatter: "appendix",
};

/** `<appendix>` sits at chapter level in a book and section level in an article. */
function appendixChild(rootTag: string | undefined): PretextDivisionTag {
  return rootTag === "book" ? "section" : "subsection";
}

function childDivisionOf(
  tag: string,
  rootTag: string | undefined,
): PretextDivisionTag | undefined {
  if (tag === "appendix") {
    return appendixChild(rootTag);
  }
  return CHILD_DIVISION[tag];
}

/** Is `(line, character)` at or after the start of `item`? */
function startsAtOrBefore(item: OutlineItem, line: number, character: number) {
  return (
    item.line < line || (item.line === line && item.character <= character)
  );
}

/**
 * Does `item` still enclose `(line, character)`? An item with no recorded end
 * was never closed, so it runs to the end of the document.
 */
function enclosesEnd(item: OutlineItem, line: number, character: number) {
  if (item.endLine === undefined) {
    return true;
  }
  return (
    item.endLine > line ||
    (item.endLine === line && (item.endCharacter ?? 0) >= character)
  );
}

/**
 * The chain of outline items containing a position, outermost first.
 *
 * Nesting is what makes this a simple descent: at each level at most one item
 * can contain the position, so there is never a choice to make.
 */
export function containerChainAt(
  items: OutlineItem[],
  line: number,
  character: number,
): OutlineItem[] {
  const chain: OutlineItem[] = [];
  let level = items;
  for (;;) {
    const match = level.find(
      (item) =>
        startsAtOrBefore(item, line, character) &&
        enclosesEnd(item, line, character),
    );
    if (!match) {
      return chain;
    }
    chain.push(match);
    level = match.children;
  }
}

export interface AttachmentPoint {
  /** Division level the imported document becomes. */
  targetTag: PretextDivisionTag;
  /** The division the new content joins. */
  containerTag: string;
  /** Zero-based line the `<xi:include>` goes on, inserted at column 0. */
  line: number;
  /** Indentation to give the `<xi:include>`. */
  indent: string;
  /** Set when the include could not go where the cursor is, and why. */
  note?: string;
}

/**
 * Resolve where an imported file attaches, given the cursor.
 *
 * Two things can move the insertion away from the cursor itself. A cursor
 * inside a `<subsubsection>` has no level below it to attach to, so the
 * insertion becomes a sibling — the child of the nearest ancestor that does
 * take divisions, placed after the one the cursor is in. And a cursor inside a
 * `<p>` is inside running prose, where an `<xi:include>` would be invalid; the
 * insertion moves to the end of the enclosing division instead.
 *
 * Returns `undefined` when the cursor is in no division at all, which is not a
 * failure to report as an error — there is simply nothing to attach to yet.
 */
export function resolveAttachmentPoint(
  text: string,
  cursorLine: number,
  cursorCharacter: number,
  offsetOfCursor: number,
): AttachmentPoint | undefined {
  const lines = text.split("\n");
  const outline = parseOutline(text);
  const chain = containerChainAt(outline, cursorLine, cursorCharacter);
  if (chain.length === 0) {
    return undefined;
  }

  const rootTag = chain[0]?.tag;

  // Walk out until a container that can hold a division. Whatever we walked
  // out of is what the new material lands after.
  let index = chain.length - 1;
  let insertAfter: OutlineItem | undefined;
  while (index >= 0 && !childDivisionOf(chain[index].tag, rootTag)) {
    insertAfter = chain[index];
    index -= 1;
  }
  if (index < 0) {
    return undefined;
  }

  const container = chain[index];
  const targetTag = childDivisionOf(container.tag, rootTag);
  if (!targetTag || !isDivisionTag(targetTag)) {
    return undefined;
  }

  let line = cursorLine;
  let note: string | undefined;

  if (insertAfter) {
    line = (insertAfter.endLine ?? cursorLine) + 1;
    note = `The cursor is inside a <${insertAfter.tag}>, which takes no divisions; the import was placed after it, as a <${targetTag}> of the enclosing <${container.tag}>.`;
  } else if (isInlineContext(text.slice(0, offsetOfCursor))) {
    // Before the container's own closing tag — the last place inside it that
    // is certainly not inside a paragraph.
    line = container.endLine ?? cursorLine;
    note = `The cursor is inside a paragraph, where an <xi:include> cannot go; the import was placed at the end of the <${container.tag}> instead.`;
  }

  const indentSource = lines[insertAfter ? line - 1 : line] ?? "";
  const indent =
    indentSource.match(/^(\s*)\S/)?.[1] ??
    (lines[container.line]?.match(/^(\s*)/)?.[1] ?? "") + "  ";

  return { targetTag, containerTag: container.tag, line, indent, note };
}

/**
 * Attach levels worth offering, given the one the cursor implies.
 *
 * The cursor's own level and anything deeper: an author may always choose to
 * nest the imported material further down than the document suggests. Shallower
 * is not offered, because a division shallower than its container cannot nest
 * inside it — the import would escape the division it was attached to.
 *
 * An off-ladder level (`<preface>`, `<appendix>`) is a role rather than a
 * depth, so it stands alone.
 */
export function offeredTargetTags(
  defaultTag: PretextDivisionTag,
): PretextDivisionTag[] {
  const depth = ladderDepth(defaultTag);
  if (depth < 0) {
    return [defaultTag];
  }
  return DIVISION_LADDER.slice(depth) as unknown as PretextDivisionTag[];
}

/**
 * The directory an included file lives in, relative to the workspace, given the
 * path of the file receiving the include. New files land beside their parent,
 * so the href written into the parent is a bare filename.
 */
export function hrefBaseFor(includingFileRelativePath: string): string {
  const slash = includingFileRelativePath.lastIndexOf("/");
  return slash < 0 ? "" : includingFileRelativePath.slice(0, slash + 1);
}

/**
 * The lines to insert at `attachment.line`: one `<xi:include>` per file the
 * import wants included here, indented to match its surroundings.
 */
export function includeBlock(
  attachment: AttachmentPoint,
  includes: string[],
): string {
  if (includes.length === 0) {
    return "";
  }
  return (
    includes.map((include) => `${attachment.indent}${include}`).join("\n") +
    "\n"
  );
}

const XI_NAMESPACE = "http://www.w3.org/2001/XInclude";

/**
 * Where to declare `xmlns:xi` in a file about to receive its first
 * `<xi:include>`, or `undefined` when it already has one.
 *
 * PreTeXt files each declare the namespace they use, so a chapter file that
 * gains its first included section needs the declaration even though the
 * project's main file already has one. Returns the offset just past the root
 * element's tag name, which is where the attribute goes.
 */
export function xiNamespaceInsertion(
  text: string,
): { offset: number; attribute: string } | undefined {
  if (/\bxmlns:xi\s*=/.test(text)) {
    return undefined;
  }
  // The first real element: skip the prolog, comments, and any doctype.
  const match = /<([a-zA-Z_][\w:.-]*)/.exec(
    text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, (m) =>
      " ".repeat(m.length),
    ),
  );
  if (!match) {
    return undefined;
  }
  return {
    offset: match.index + match[0].length,
    attribute: ` xmlns:xi="${XI_NAMESPACE}"`,
  };
}

/**
 * The `external` directory a publication file declares, or `undefined`.
 *
 * Read here with a regex rather than through `readAssetDirectories` in
 * `@pretextbook/pretext-html`, which is the authority on the full rules
 * (`generated` too, and the managed-directories pairing). Importing it would
 * pull libxslt-wasm into the extension-host bundle, which is exactly what the
 * forked preview worker exists to avoid — and one attribute does not justify
 * that. A leading "/" is a publication-file error PreTeXt ignores, so it is
 * treated as unset here too.
 */
export function readExternalDirectory(
  publicationXml: string,
): string | undefined {
  const directories = /<directories\b[^>]*>/.exec(publicationXml)?.[0];
  const external = directories
    ? /\bexternal\s*=\s*["']([^"']*)["']/.exec(directories)?.[1]
    : undefined;
  if (!external || external.startsWith("/")) {
    return undefined;
  }
  return external.replace(/\/+$/, "");
}
