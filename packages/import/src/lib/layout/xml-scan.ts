// Lightweight XML element scanning. Not a full parser — it tracks generic
// element nesting depth so finders correctly identify elements as direct
// children of whatever wraps the input substring. Skips XML comments, CDATA,
// processing instructions, and declarations.

export interface XmlElementSpan {
  name: string;
  start: number; // index of the opening '<'
  startTagEnd: number; // index just past the opening tag's '>'
  contentEnd: number; // index of the '<' that opens the closing tag
  end: number; // index just past the closing tag's '>'
  inner: string;
  outer: string;
  attributes: Record<string, string>;
}

const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(attrString: string): Record<string, string> {
  const result: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    result[m[1]] = m[2] ?? m[3] ?? '';
  }
  return result;
}

type Token =
  | { kind: 'open'; name: string; attrs: string; pos: number; end: number }
  | { kind: 'close'; name: string; pos: number; end: number }
  | {
      kind: 'selfclose';
      name: string;
      attrs: string;
      pos: number;
      end: number;
    };

// Scan all element tags, skipping comments / CDATA / PIs / DOCTYPE.
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;
  while (i < len) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;

    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      i = close < 0 ? len : close + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const close = source.indexOf(']]>', lt + 9);
      i = close < 0 ? len : close + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const close = source.indexOf('?>', lt + 2);
      i = close < 0 ? len : close + 2;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      // declaration like <!DOCTYPE ...>
      const close = source.indexOf('>', lt + 2);
      i = close < 0 ? len : close + 1;
      continue;
    }

    // Regular tag. Find the matching '>' but allow '>' inside attribute values.
    let j = lt + 1;
    let isClose = false;
    if (source[j] === '/') {
      isClose = true;
      j += 1;
    }
    // Read tag name.
    const nameMatch = /^[a-zA-Z_:][\w:.-]*/.exec(source.slice(j));
    if (!nameMatch) {
      // Not a real tag; advance.
      i = lt + 1;
      continue;
    }
    const name = nameMatch[0];
    j += name.length;

    // Find the end of the tag, respecting quoted attribute values.
    let attrStart = j;
    let inQuote: '"' | "'" | null = null;
    while (j < len) {
      const c = source[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
        j += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        inQuote = c;
        j += 1;
        continue;
      }
      if (c === '>') {
        break;
      }
      j += 1;
    }
    if (j >= len) break;

    const tagEnd = j + 1;
    const beforeGt = source.slice(attrStart, j);
    const selfClosing = !isClose && beforeGt.trimEnd().endsWith('/');
    const attrs = selfClosing ? beforeGt.replace(/\/\s*$/, '') : beforeGt;

    if (isClose) {
      tokens.push({ kind: 'close', name, pos: lt, end: tagEnd });
    } else if (selfClosing) {
      tokens.push({ kind: 'selfclose', name, attrs, pos: lt, end: tagEnd });
    } else {
      tokens.push({ kind: 'open', name, attrs, pos: lt, end: tagEnd });
    }
    i = tagEnd;
  }
  return tokens;
}

// Finds top-level <name>...</name> elements within `source` — elements whose
// open tag occurs at depth 0 relative to other element tags in the source.
export function findTopLevelElements(
  source: string,
  name: string,
): XmlElementSpan[] {
  const tokens = tokenize(source);
  const out: XmlElementSpan[] = [];
  let depth = 0;
  let currentOpen: Token | null = null;

  for (const tok of tokens) {
    if (tok.kind === 'selfclose') {
      if (depth === 0 && tok.name === name) {
        out.push({
          name,
          start: tok.pos,
          startTagEnd: tok.end,
          contentEnd: tok.end,
          end: tok.end,
          inner: '',
          outer: source.slice(tok.pos, tok.end),
          attributes: parseAttributes(tok.attrs),
        });
      }
      continue;
    }
    if (tok.kind === 'open') {
      if (depth === 0 && tok.name === name && !currentOpen) {
        currentOpen = tok;
      }
      depth += 1;
      continue;
    }
    // close
    depth -= 1;
    if (depth < 0) depth = 0;
    if (currentOpen && depth === 0 && tok.name === name) {
      out.push({
        name,
        start: currentOpen.pos,
        startTagEnd: currentOpen.end,
        contentEnd: tok.pos,
        end: tok.end,
        inner: source.slice(currentOpen.end, tok.pos),
        outer: source.slice(currentOpen.pos, tok.end),
        attributes: parseAttributes((currentOpen as { attrs: string }).attrs),
      });
      currentOpen = null;
    }
  }
  return out;
}

export function findFirstElement(
  source: string,
  name: string,
): XmlElementSpan | null {
  const all = findTopLevelElements(source, name);
  return all[0] ?? null;
}

// Find the first <name> element anywhere in the document, regardless of nesting depth.
export function findAnyElement(
  source: string,
  name: string,
): XmlElementSpan | null {
  const tokens = tokenize(source);
  let depth = 0;
  let targetOpen: Token | null = null;
  let targetOpenDepth = -1;

  for (const tok of tokens) {
    if (tok.kind === 'selfclose') {
      if (!targetOpen && tok.name === name) {
        return {
          name,
          start: tok.pos,
          startTagEnd: tok.end,
          contentEnd: tok.end,
          end: tok.end,
          inner: '',
          outer: source.slice(tok.pos, tok.end),
          attributes: parseAttributes(tok.attrs),
        };
      }
      continue;
    }
    if (tok.kind === 'open') {
      if (!targetOpen && tok.name === name) {
        targetOpen = tok;
        targetOpenDepth = depth;
      }
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth < 0) depth = 0;
    if (targetOpen && tok.name === name && depth === targetOpenDepth) {
      const attrs = (targetOpen as { attrs: string }).attrs;
      return {
        name,
        start: targetOpen.pos,
        startTagEnd: targetOpen.end,
        contentEnd: tok.pos,
        end: tok.end,
        inner: source.slice(targetOpen.end, tok.pos),
        outer: source.slice(targetOpen.pos, tok.end),
        attributes: parseAttributes(attrs),
      };
    }
  }
  return null;
}
