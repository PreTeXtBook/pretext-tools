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
  book: { icon: 'book', label: 'Book' },
  article: { icon: 'book', label: 'Article' },
  frontmatter: { icon: 'info', label: 'Front Matter' },
  backmatter: { icon: 'info', label: 'Back Matter' },
  chapter: { icon: 'symbol-class', label: 'Chapter' },
  section: { icon: 'symbol-class', label: 'Section' },
  subsection: { icon: 'symbol-method', label: 'Subsection' },
  subsubsection: { icon: 'symbol-field', label: 'Subsubsection' },
  paragraphs: { icon: 'symbol-text', label: 'Paragraphs' },
  references: { icon: 'references', label: 'References' },
  appendix: { icon: 'symbol-class', label: 'Appendix' },
};

// Only these tags appear in the outline — section headings and structural containers.
export const OUTLINE_TAGS = new Set(Object.keys(ELEMENT_CONFIG));

// Tags that can contain other outline-relevant elements.
export const CONTAINER_TAGS = new Set([
  'book',
  'article',
  'frontmatter',
  'backmatter',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'appendix',
]);

/** A plain (vscode-free) node in the parsed outline tree. */
export interface OutlineItem {
  tag: string;
  title: string;
  xmlId: string;
  line: number;
  character: number;
  children: OutlineItem[];
}

/**
 * Parse a .ptx document's text into a tree of {@link OutlineItem}s.
 */
export function parseOutline(text: string): OutlineItem[] {
  const roots: OutlineItem[] = [];

  // Stack to track nesting: each entry is [tag, node].
  const stack: Array<{ tag: string; node: OutlineItem }> = [];

  const lines = text.split('\n');
  let inComment = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip XML comments (simple heuristic — not perfect but good enough).
    if (line.includes('<!--')) {
      inComment = true;
    }
    if (inComment) {
      if (line.includes('-->')) {
        inComment = false;
      }
      continue;
    }

    // Check for closing tags — pop the stack.
    for (const tag of OUTLINE_TAGS) {
      const closeMatch = new RegExp(`</${tag}\\s*>`).exec(line);
      if (!closeMatch) {
        continue;
      }
      // If the same tag also *opens* earlier on this line, the element is
      // self-contained on one line (e.g. `<section>...</section>`). Its close
      // does not belong to anything on the stack, so leave the stack alone;
      // the opening handler below adds it as a leaf.
      const openBeforeClose = new RegExp(`<${tag}(?:\\s|>|/)`).exec(line);
      if (openBeforeClose && openBeforeClose.index < closeMatch.index) {
        continue;
      }
      // Pop until we find the matching open tag.
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        stack.pop();
        if (top.tag === tag) {
          break;
        }
      }
    }

    // Check for opening tags.
    for (const tag of OUTLINE_TAGS) {
      const openPattern = new RegExp(`<${tag}(?:\\s|>|/)`);
      const openMatch = openPattern.exec(line);
      if (!openMatch) {
        continue;
      }

      // Extract xml:id if present.
      let xmlId = '';
      const idMatch = line.match(/xml:id=["']([^"']+)["']/);
      if (idMatch) {
        xmlId = idMatch[1];
      }

      const title = extractTitle(lines, lineNum);

      const node: OutlineItem = {
        tag,
        title,
        xmlId,
        line: lineNum,
        character: openMatch.index,
        children: [],
      };

      // Add to parent's children or to roots.
      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        roots.push(node);
      }

      // Push onto the stack only if this tag can contain children AND it is not
      // already closed on this same line (a self-contained element is a leaf).
      const closeOnLine = new RegExp(`</${tag}\\s*>`).exec(line);
      const selfContained = closeOnLine && openMatch.index < closeOnLine.index;
      if (CONTAINER_TAGS.has(tag) && !selfContained) {
        stack.push({ tag, node });
      }

      // Only match the first outline tag per line.
      break;
    }
  }

  return roots;
}

/**
 * Extract the text content of a `<title>...</title>` element starting from the
 * given line. Looks ahead up to 8 lines to handle multi-line titles.
 */
export function extractTitle(lines: string[], startLine: number): string {
  const searchWindow = lines
    .slice(startLine, Math.min(startLine + 8, lines.length))
    .join('\n');

  const singleLine = searchWindow.match(/<title>(.*?)<\/title>/);
  if (singleLine) {
    return cleanText(singleLine[1]);
  }

  const multiLine = searchWindow.match(/<title>\s*([\s\S]*?)\s*<\/title>/);
  if (multiLine) {
    return cleanText(multiLine[1]);
  }

  return '';
}

/** Clean extracted text: strip XML tags, collapse whitespace. */
export function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
