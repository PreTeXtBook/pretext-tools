import { fromXml } from 'xast-util-from-xml';
import type { Root, Element, ElementContent, RootContent } from 'xast';
import type { Plugin } from 'unified';
import {
  blockTags,
  lineEndTags,
  newlineTags,
  parTags,
  smartParTags,
  verbatimTags,
} from './docStructure';

export interface FormatOptions {
  breakLines?: 'few' | 'some' | 'many';
  breakSentences?: boolean;
  /** Wrap long block start-tag attributes onto separate lines. */
  breakLongAttributes?: boolean;
  insertSpaces?: boolean;
  tabSize?: number;
  /** Target line width for paragraph text reflow. 0 = no width limit. Default 80. */
  printWidth?: number;
}

interface Ctx {
  ind: string; // one indent unit (e.g. "  "); caller repeats it per depth level
  blankLines: 'few' | 'some' | 'many';
  breakSentences: boolean;
  breakLongAttributes: boolean;
  printWidth: number;
}

function makeCtx(options?: FormatOptions): Ctx {
  const blankLines = options?.breakLines ?? 'some';
  const tabSize = options?.tabSize ?? 2;
  const insertSpaces = options?.insertSpaces ?? true;
  const breakSentences = options?.breakSentences ?? false;
  const breakLongAttributes = options?.breakLongAttributes ?? false;
  const printWidth = options?.printWidth ?? 80;
  const ind = insertSpaces ? ' '.repeat(tabSize) : '\t';
  return { ind, blankLines, breakSentences, breakLongAttributes, printWidth };
}

/**
 * Serialize an already-parsed xast Root tree to formatted PreTeXt XML.
 *
 * Pipeline: each node is dispatched to a category-specific appender that pushes
 * indented lines into an array, then applyBlankLines inserts blank separators as
 * a post-processing pass, and the array is joined with newlines.
 */
export function serializeXast(tree: Root, options?: FormatOptions): string {
  const ctx = makeCtx(options);
  const lines: string[] = [];
  // First remove the dummy root if present (see formatPretext) so it doesn't interfere with formatting decisions, but keep its children.
  if (
    tree.children.length === 1 &&
    tree.children[0].type === 'element' &&
    tree.children[0].name === 'tmp-root'
  ) {
    tree = { ...tree, children: tree.children[0].children };
  }
  for (const child of tree.children) {
    appendNode(child, lines, 0, ctx);
  }
  const result = applyBlankLines(lines, ctx);
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result.join('\n');
}

/** Unified compiler plugin: formats the xast tree produced by the pipeline. */
export const pretextFormatPlugin: Plugin<[FormatOptions?], Root, string> =
  function (options) {
    this.compiler = (tree) => serializeXast(tree as Root, options);
  };

/** Main entry point for formatting PreTeXt XML strings. */
export function formatPretext(text: string, options?: FormatOptions): string {
  let tree: Root;
  // If the input contains an xml declaration, it must be preserved verbatim at the top of the output; the serializer doesn't handle it as a normal processing instruction node since it must always come first. So we extract it before parsing and prepend it back to the final output.
  let xmlDecl: string | null = null;
  if (text.startsWith('<?xml')) {
    const declEndIdx = text.indexOf('?>');
    if (declEndIdx !== -1) {
      const endIdx = declEndIdx + 2;
      xmlDecl = text.slice(0, endIdx);
      text = text.slice(endIdx);
    }
  }
  // Wrap the rest of the text in a dummy root in case text contains multiple top-level nodes.
  text = `<tmp-root>${text}</tmp-root>`;
  // Parse the XML text into an xast tree. If parsing fails (e.g. due to unescaped special characters), log a warning and return the original text unmodified.
  try {
    tree = fromXml(text);
  } catch {
    console.warn('Input is not well-formed XML; returning original text.');
    //strip the dummy root before returning, since it was only needed for parsing and would be confusing to include in the output.
    text = text.replace(/<tmp-root>(.*?)<\/tmp-root>/s, '$1');
    if (xmlDecl) {
      text = xmlDecl + '\n\n' + text;
    }
    return text;
  }
  // serializeXast will remove the dummy root.
  let result = serializeXast(tree, options);
  // Add back the XML declaration if it was present in the input, ensuring it's followed by a blank line for readability.
  if (xmlDecl) {
    result = xmlDecl + '\n\n' + result;
  }
  return result;
}

// General strategy: recursively walk the tree depth-first, building an array of output lines as we go.
// Each node is dispatched to an appender function based on its tag name and role in the document structure,
// which handles indentation and line breaks according to the formatting rules for that category of node.
// So we flow through appendNode → appendElement → appendPar/appendMixedPar/appendBlock/appendVerbatim/appendLineEnd, depending on the node type and tag,
// and these call appendNode or another appender recursively on their children as needed.

// After the tree is fully serialized into an array of lines,
// a post-processing pass inserts blank lines according to the breakLines option, and the array is joined into the final output string.

// ─── Node dispatch ────────────────────────────────────────────────────────────

function appendNode(
  node: RootContent | ElementContent,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  switch (node.type) {
    case 'instruction':
      out.push(`<?${node.name}${node.value ? ' ' + node.value : ''}?>`);
      break;
    case 'doctype':
      out.push(`<!DOCTYPE ${node.name}>`);
      break;
    case 'comment':
      out.push(`${ctx.ind.repeat(depth)}<!--${node.value}-->`);
      break;
    case 'cdata':
      out.push(`${ctx.ind.repeat(depth)}<![CDATA[${node.value}]]>`);
      break;
    case 'text': {
      // Whitespace-only text between tags is dropped; non-empty text is re-indented.
      const v = node.value.trim();
      if (v) out.push(`${ctx.ind.repeat(depth)}${escText(v)}`);
      break;
    }
    case 'element':
      appendElement(node, out, depth, ctx);
      break;
  }
}

function appendElement(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  // Dispatch order matters: verbatim is checked first so it wins even for tags
  // that also appear in blockTags. smartParTags is checked before lineEndTags so
  // it takes precedence for tags that appear in both lists (e.g. title, caption).
  // parTags are split by whether they contain structural block children.
  // Everything else falls through to appendBlock.
  const name = node.name;
  if (verbatimTags.includes(name)) {
    appendVerbatim(node, out, depth, ctx);
  } else if (smartParTags.includes(name)) {
    appendSmartPar(node, out, depth, ctx);
  } else if (lineEndTags.includes(name)) {
    appendLineEnd(node, out, depth, ctx);
  } else if (parTags.includes(name) && !hasBlockChildren(node)) {
    appendPar(node, out, depth, ctx);
  } else if (parTags.includes(name)) {
    appendMixedPar(node, out, depth, ctx);
  } else {
    appendBlock(node, out, depth, ctx);
  }
}

// ─── Verbatim ─────────────────────────────────────────────────────────────────

function appendVerbatim(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  // If the element contains child elements (e.g. <program><input>...</input></program>),
  // fall back to block formatting — the children will be verbatim-handled individually.
  if (node.children.some((c) => c.type === 'element')) {
    appendBlock(node, out, depth, ctx);
    return;
  }
  const ind = ctx.ind.repeat(depth);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }

  // Preserve verbatim inner content exactly as parsed (including newlines and
  // trailing spaces), while still escaping text-node XML entities.
  const raw = node.children
    .map((c) => {
      if (c.type === 'text') return escText(c.value);
      if (c.type === 'cdata') return `<![CDATA[${c.value}]]>`;
      return '';
    })
    .join('');
  const trailingNewlineWithWhitespace = /\n[ \t]*$/.test(raw);
  if (trailingNewlineWithWhitespace) {
    // Strip any trailing whitespace after the final newline so the closing tag
    // gets the correct indentation.
    const trimmedRaw = raw.replace(/\n[ \t]*$/, '\n');
    out.push(`${ind}${openTag(node)}${trimmedRaw}${ind}</${node.name}>`);
  } else {
    // Otherwise, render the whole verbatim element on one line. Any internal newlines will be preserved as literal \n characters in the text content, and any trailing spaces will be preserved because the closing tag is on the same line.
    out.push(`${ind}${openTag(node)}${raw}</${node.name}>`);
  }
}

// ─── Line-end ─────────────────────────────────────────────────────────────────

function appendLineEnd(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  const ind = ctx.ind.repeat(depth);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }
  const content = inlineSerialize(node.children);
  out.push(`${ind}${openTag(node)}${content}</${node.name}>`);
}

// ─── Smart paragraph (single-line if fits, par reflow if too long) ───────────

function appendSmartPar(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  const ind = ctx.ind.repeat(depth);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }
  // Uncommon: a smartParTag containing block children (e.g. display math in a title).
  // Delegate to mixed-par which handles the inline-run / block-child alternation.
  if (hasBlockChildren(node)) {
    appendMixedPar(node, out, depth, ctx);
    return;
  }
  // Always normalise through the token pipeline so author-introduced newlines or
  // extra whitespace in the source are collapsed, and inline elements are handled
  // the same way as in appendPar (punctuation merging, opaque token treatment).
  const tokens = collectTokens(node.children);
  const childInd = ctx.ind.repeat(depth + 1);

  // Try single-line: join all tokens and check if the whole rendered line fits.
  const singleLine = `${ind}${openTag(node)}${tokens.join(' ')}</${node.name}>`;
  if (ctx.printWidth === 0 || singleLine.length <= ctx.printWidth) {
    out.push(singleLine);
    return;
  }
  // Doesn't fit — reflow in par format (open tag, wrapped content, close tag).
  out.push(`${ind}${openTag(node)}`);
  for (const line of reflowTokens(
    tokens,
    ctx.printWidth,
    childInd.length,
    ctx.breakSentences,
  )) {
    out.push(`${childInd}${line}`);
  }
  out.push(`${ind}</${node.name}>`);
}

// ─── Pure paragraph (no block children) ──────────────────────────────────────

function appendPar(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  const ind = ctx.ind.repeat(depth);
  const childInd = ctx.ind.repeat(depth + 1);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }
  out.push(`${ind}${openTag(node)}`);
  const tokens = collectTokens(node.children);
  for (const line of reflowTokens(
    tokens,
    ctx.printWidth,
    childInd.length,
    ctx.breakSentences,
  )) {
    out.push(`${childInd}${line}`);
  }
  out.push(`${ind}</${node.name}>`);
}

// ─── Mixed paragraph (has block children like <md>, <ul>) ────────────────────

function appendMixedPar(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  // A mixed <p> alternates between inline runs (text + inline elements) and
  // structural block children (display math, lists, etc.). Each inline run is
  // collected and reflowed as a unit; each block child is recursively serialized.
  const ind = ctx.ind.repeat(depth);
  const childInd = ctx.ind.repeat(depth + 1);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }
  out.push(`${ind}${openTag(node)}`);

  const children = meaningfulChildren(node);
  let i = 0;
  while (i < children.length) {
    if (isBlockChild(children[i])) {
      const child = children[i] as Element;
      i++;

      // Fuse any immediately-following punctuation (e.g. the "." after </md>) onto
      // the closing tag line rather than letting it appear as a dangling token on
      // the next line.
      let punctuation = '';
      if (i < children.length && children[i].type === 'text') {
        const textVal: string = (children[i] as any).value;
        const m = /^(\s*)([.,;:!?])/.exec(textVal);
        if (m) {
          punctuation = m[2];
          const remaining = textVal.slice(m[0].length);
          // Consume the punctuation from the text node; skip the node if now empty.
          (children[i] as any).value = remaining;
          if (!remaining.trim()) i++;
        }
      }

      const blockLines: string[] = [];
      appendElement(child, blockLines, depth + 1, ctx);
      if (punctuation && blockLines.length > 0) {
        blockLines[blockLines.length - 1] += punctuation;
      }
      out.push(...blockLines);
    } else {
      // Collect contiguous inline children (text nodes + inline elements) into one
      // run, then reflow the whole run at printWidth.
      const run: ElementContent[] = [];
      while (i < children.length && !isBlockChild(children[i])) {
        run.push(children[i]);
        i++;
      }
      const tokens = collectTokens(run);
      if (tokens.length > 0) {
        for (const line of reflowTokens(
          tokens,
          ctx.printWidth,
          childInd.length,
          ctx.breakSentences,
        )) {
          out.push(`${childInd}${line}`);
        }
      }
    }
  }

  out.push(`${ind}</${node.name}>`);
}

// ─── Block ────────────────────────────────────────────────────────────────────

function appendBlock(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  const ind = ctx.ind.repeat(depth);
  if (isEmptyElement(node)) {
    out.push(...startTagLines(node, depth, ctx, true));
    return;
  }

  // Special case: any node whose only meaningful child is xi:include stays on one line.
  // e.g. <outernode><xi:include href="..."/></outernode>
  const mc = meaningfulChildren(node);
  if (
    mc.length === 1 &&
    mc[0].type === 'element' &&
    (mc[0] as Element).name === 'xi:include'
  ) {
    const el = mc[0] as Element;
    const startLines = startTagLines(node, depth, ctx);
    if (startLines.length === 1) {
      const inner = isEmptyElement(el)
        ? selfClose(el)
        : `${openTag(el)}${inlineSerialize(el.children)}</${el.name}>`;
      out.push(`${startLines[0]}${inner}</${node.name}>`);
      return;
    }
    out.push(...startLines);
    appendNode(el, out, depth + 1, ctx);
    out.push(`${ind}</${node.name}>`);
    return;
  }

  //Add starting tag as its own line.
  out.push(...startTagLines(node, depth, ctx));
  for (const child of meaningfulChildren(node)) {
    appendNode(child, out, depth + 1, ctx);
  }
  // Add closing tag as its own line.
  out.push(`${ind}</${node.name}>`);
}

// ─── Blank line post-processing ───────────────────────────────────────────────
// Blank lines are inserted as a separate pass so the serializer functions above
// don't need look-ahead logic while building the line array.

function applyBlankLines(lines: string[], ctx: Ctx): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const next = i < lines.length - 1 ? lines[i + 1].trim() : null;

    result.push(lines[i]);

    // Always insert a blank line after the XML declaration.
    if (i === 0 && /^<\?xml(?:\s|\?>)/.test(cur)) {
      result.push('');
      continue;
    }

    if (ctx.blankLines === 'few') continue;

    if (ctx.blankLines === 'some') {
      // Blank before section/environment opening tags (the most common readable spacing).
      if (cur.startsWith('</') && next !== null && next.startsWith('<')) {
        const nextTag = /^<([^\s>/]+)/.exec(next)?.[1];
        if (nextTag && newlineTags.includes(nextTag)) result.push('');
      } else if (/^<title[\s>]/.test(cur) && cur.includes('</title>')) {
        // Blank after a complete single-line <title>...</title>.
        // Don't fire for the opening tag of a multi-line expanded title — that
        // would inject a blank line between the open tag and the title text.
        result.push('');
      }
    } else if (ctx.blankLines === 'many') {
      // Blank after every closing tag, or between consecutive opening tags.
      if (
        cur.startsWith('</') ||
        (cur.startsWith('<') && next !== null && next.startsWith('<'))
      ) {
        result.push('');
      }
    }
  }

  return result;
}

// ─── Inline serialization ─────────────────────────────────────────────────────

function inlineSerialize(children: ElementContent[]): string {
  return children
    .map((c) => {
      if (c.type === 'text') return escText(c.value);
      if (c.type === 'element') return inlineEl(c);
      if (c.type === 'comment') return `<!--${c.value}-->`;
      if (c.type === 'cdata') return `<![CDATA[${c.value}]]>`;
      return '';
    })
    .join('');
}

function inlineEl(node: Element): string {
  if (isEmptyElement(node)) return selfClose(node);
  return `${openTag(node)}${inlineSerialize(node.children)}</${node.name}>`;
}

// ─── Token collection and reflow ──────────────────────────────────────────────

function collectTokens(children: ElementContent[]): string[] {
  // Produces a flat list of reflow tokens: words from text nodes, and serialized
  // inline elements treated as opaque single tokens.
  const tokens: string[] = [];
  for (const c of children) {
    if (c.type === 'text') {
      const words: string[] = c.value
        .split(/\s+/)
        .filter((w: string) => w.length > 0);
      for (let j = 0; j < words.length; j++) {
        const w = escText(words[j]);
        // If this text node begins with punctuation or a hyphen immediately after an
        // element (e.g. ", we have" or "-functions"), merge onto the previous token.
        // Covers: "<m>x</m>, we" → "<m>x</m>," and "<m>L</m>-functions" → "<m>L</m>-functions".
        if (j === 0 && tokens.length > 0 && /^[.,;:!?\-]/.test(w)) {
          tokens[tokens.length - 1] += w;
        } else {
          tokens.push(w);
        }
      }
    } else if (c.type === 'element') {
      tokens.push(inlineEl(c));
    } else if (c.type === 'comment') {
      tokens.push(`<!--${c.value}-->`);
    }
  }
  return tokens;
}

function reflowTokens(
  tokens: string[],
  printWidth: number,
  indentLen: number,
  breakSentences: boolean,
): string[] {
  if (tokens.length === 0) return [];
  // 0 means no width limit; otherwise floor at 20 so deeply-nested content
  // doesn't produce a zero/negative target when the indent exceeds printWidth.
  const width =
    printWidth === 0 ? Infinity : Math.max(20, printWidth - indentLen);
  const lines: string[] = [];
  let cur = '';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (cur === '') {
      cur = tok;
    } else if (cur.length + 1 + tok.length <= width) {
      cur += ' ' + tok;
    } else {
      lines.push(cur);
      cur = tok;
    }
    if (breakSentences && /[.!?]$/.test(tok) && i < tokens.length - 1) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Tag building helpers ─────────────────────────────────────────────────────

function openTag(node: Element): string {
  const attrs = buildAttrs(node);
  return attrs ? `<${node.name} ${attrs}>` : `<${node.name}>`;
}

function selfClose(node: Element): string {
  const attrs = buildAttrs(node);
  return attrs ? `<${node.name} ${attrs}/>` : `<${node.name}/>`;
}

function buildAttrs(node: Element): string {
  return buildAttrList(node).join(' ');
}

function buildAttrList(node: Element): string[] {
  return (
    Object.entries(node.attributes || {})
      // v == null (loose equality) covers both null and undefined that can appear
      // in Object.entries output for boolean/valueless XML attributes.
      .map(([k, v]) => (v == null ? k : `${k}="${escAttr(v)}"`))
  );
}

function startTagLines(
  node: Element,
  depth: number,
  ctx: Ctx,
  selfClosing = false,
): string[] {
  const ind = ctx.ind.repeat(depth);
  const attrs = buildAttrList(node);
  const close = selfClosing ? '/>' : '>';
  if (attrs.length === 0) {
    return [`${ind}<${node.name}${close}`];
  }

  const singleLine = `${ind}<${node.name} ${attrs.join(' ')}${close}`;
  if (
    !ctx.breakLongAttributes ||
    ctx.printWidth === 0 ||
    singleLine.length <= ctx.printWidth
  ) {
    return [singleLine];
  }

  const continuationIndent = `${ind}${' '.repeat(node.name.length + 2)}`;
  const lines = [`${ind}<${node.name} ${attrs[0]}`];
  for (const attr of attrs.slice(1)) {
    lines.push(`${continuationIndent}${attr}`);
  }
  lines[lines.length - 1] += close;
  return lines;
}

// ─── Predicates ───────────────────────────────────────────────────────────────

function isEmptyElement(node: Element): boolean {
  // The XML parser always emits text nodes for whitespace between tags, so "empty"
  // means every child is a whitespace-only text node.
  return node.children.every((c) => c.type === 'text' && c.value.trim() === '');
}

function meaningfulChildren(node: Element): ElementContent[] {
  // Strip the whitespace-only text nodes the parser emits between elements so
  // the serializer only sees structurally significant children.
  return node.children.filter(
    (c) => !(c.type === 'text' && c.value.trim() === ''),
  );
}

function isBlockChild(child: ElementContent): boolean {
  if (child.type !== 'element') return false;
  const name = child.name;
  // <c> is in verbatimTags (inline code) but is always rendered inline, never as a
  // structural block, so it must be excluded before the verbatimTags check below.
  if (name === 'c') return false;
  // Some tag names are reused for both a block-level environment (with content,
  // e.g. the root <pretext> document or a <webwork> exercise) and an inline macro
  // (empty/self-closing, e.g. the <pretext/> logo or an embedded <webwork/>
  // problem reference). An empty element is always the inline-macro usage, so it
  // should flow with the surrounding text like <latex/> rather than force a line
  // break.
  if (isEmptyElement(child)) return false;
  // verbatimTags is included alongside blockTags because structural verbatim elements
  // (<pre>, <program>, etc.) break the inline flow of a <p> just like block elements do.
  return (
    (blockTags.includes(name) || verbatimTags.includes(name)) &&
    !lineEndTags.includes(name)
  );
}

function hasBlockChildren(node: Element): boolean {
  return node.children.some((c) => isBlockChild(c));
}

// ─── Text escaping ────────────────────────────────────────────────────────────
// The functions above will usually be passed a tree that was produced by parsing xml, so there would not be any special characters.  However, other libraries might forget to escape these, so we include them here just in case.
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
