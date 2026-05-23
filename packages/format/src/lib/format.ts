import { fromXml } from "xast-util-from-xml";
import type { Root, Element, ElementContent, RootContent } from "xast";
import type { Plugin } from "unified";
import {
  blockTags,
  lineEndTags,
  newlineTags,
  parTags,
  verbatimTags,
} from "./docStructure";

export { formatPretextLegacy } from "./format-legacy";

export interface FormatOptions {
  breakLines?: "few" | "some" | "many";
  breakSentences?: boolean;
  insertSpaces?: boolean;
  tabSize?: number;
  printWidth?: number;
}

interface Ctx {
  ind: string;
  blankLines: "few" | "some" | "many";
  breakSentences: boolean;
  printWidth: number;
}

function makeCtx(options?: FormatOptions): Ctx {
  const blankLines = options?.breakLines ?? "some";
  const tabSize = options?.tabSize ?? 2;
  const insertSpaces = options?.insertSpaces ?? true;
  const breakSentences = options?.breakSentences ?? false;
  const printWidth = options?.printWidth ?? 80;
  const ind = insertSpaces ? " ".repeat(tabSize) : "\t";
  return { ind, blankLines, breakSentences, printWidth };
}

/** Serialize an already-parsed xast Root tree to formatted PreTeXt XML. */
export function serializeXast(tree: Root, options?: FormatOptions): string {
  const ctx = makeCtx(options);
  const lines: string[] = [];
  for (const child of tree.children) {
    appendNode(child, lines, 0, ctx);
  }
  const result = applyBlankLines(lines, ctx);
  while (result.length > 0 && result[result.length - 1] === "") result.pop();
  return result.join("\n");
}

/** Unified compiler plugin: formats the xast tree produced by the pipeline. */
export const pretextFormatPlugin: Plugin<[FormatOptions?], Root, string> =
  function (options) {
    this.compiler = (tree) => serializeXast(tree as Root, options);
  };

export function formatPretext(text: string, options?: FormatOptions): string {
  let tree: Root;
  try {
    tree = fromXml(text);
  } catch {
    return text;
  }
  return serializeXast(tree, options);
}

// ─── Node dispatch ────────────────────────────────────────────────────────────

function appendNode(
  node: RootContent | ElementContent,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  switch (node.type) {
    case "instruction":
      out.push(`<?${node.name}${node.value ? " " + node.value : ""}?>`);
      break;
    case "doctype":
      out.push(`<!DOCTYPE ${node.name}>`);
      break;
    case "comment":
      out.push(`${ctx.ind.repeat(depth)}<!--${(node as any).value}-->`);
      break;
    case "cdata":
      out.push(
        `${ctx.ind.repeat(depth)}<![CDATA[${(node as any).value}]]>`,
      );
      break;
    case "text": {
      const v = (node as any).value.trim();
      if (v) out.push(`${ctx.ind.repeat(depth)}${escText(v)}`);
      break;
    }
    case "element":
      appendElement(node as Element, out, depth, ctx);
      break;
  }
}

function appendElement(
  node: Element,
  out: string[],
  depth: number,
  ctx: Ctx,
): void {
  const name = node.name;
  if (verbatimTags.includes(name)) {
    appendVerbatim(node, out, depth, ctx);
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
  if (node.children.some((c) => c.type === "element")) {
    appendBlock(node, out, depth, ctx);
    return;
  }
  const ind = ctx.ind.repeat(depth);
  if (isEmptyElement(node)) {
    out.push(`${ind}${selfClose(node)}`);
    return;
  }
  const raw = extractVerbatimContent(node);
  // Single-line verbatim stays on one line
  if (!raw.includes("\n")) {
    out.push(`${ind}${openTag(node)}${raw}</${node.name}>`);
    return;
  }
  out.push(`${ind}${openTag(node)}`);
  for (const line of raw.split("\n")) out.push(line);
  out.push(`${ind}</${node.name}>`);
}

function extractVerbatimContent(node: Element): string {
  const raw = node.children
    .map((c) => {
      if (c.type === "text") return escText((c as any).value);
      if (c.type === "cdata") return `<![CDATA[${(c as any).value}]]>`;
      return "";
    })
    .join("");
  // Strip one leading newline and all trailing blank lines (but preserve content)
  return raw.replace(/^\n/, "").replace(/(\n\s*)*$/, "");
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
  for (const line of reflowTokens(tokens, ctx.printWidth, childInd.length, ctx.breakSentences)) {
    out.push(`${childInd}${line}`);
  }
  out.push(`${ind}</${node.name}>`);
}

// ─── Mixed paragraph (has block children like <me>, <ul>) ────────────────────

function appendMixedPar(
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

  const children = meaningfulChildren(node);
  let i = 0;
  while (i < children.length) {
    if (isBlockChild(children[i])) {
      const child = children[i] as Element;
      i++;

      // Check for punctuation immediately after this block element
      let punct = "";
      if (i < children.length && children[i].type === "text") {
        const textVal: string = (children[i] as any).value;
        const m = /^(\s*)([.,;:!?])/.exec(textVal);
        if (m) {
          punct = m[2];
          const remaining = textVal.slice(m[0].length);
          // Replace this text node's value with what remains after the punct
          (children[i] as any).value = remaining;
          if (!remaining.trim()) i++; // skip entirely if nothing left
        }
      }

      const blockLines: string[] = [];
      appendElement(child, blockLines, depth + 1, ctx);
      if (punct && blockLines.length > 0) {
        blockLines[blockLines.length - 1] += punct;
      }
      out.push(...blockLines);
    } else {
      // Collect contiguous inline run
      const run: ElementContent[] = [];
      while (i < children.length && !isBlockChild(children[i])) {
        run.push(children[i]);
        i++;
      }
      const tokens = collectTokens(run);
      if (tokens.length > 0) {
        for (const line of reflowTokens(tokens, ctx.printWidth, childInd.length, ctx.breakSentences)) {
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
    out.push(`${ind}${selfClose(node)}`);
    return;
  }

  // Special case: webwork containing only lineEndTag children stays on one line.
  // e.g. <webwork><xi:include href="..."/></webwork>
  if (node.name === "webwork") {
    const mc = meaningfulChildren(node);
    if (
      mc.length > 0 &&
      mc.every(
        (c) =>
          c.type === "element" &&
          lineEndTags.includes((c as Element).name),
      )
    ) {
      const inner = mc
        .map((c) => {
          const el = c as Element;
          return isEmptyElement(el)
            ? selfClose(el)
            : `${openTag(el)}${inlineSerialize(el.children)}</${el.name}>`;
        })
        .join("");
      out.push(`${ind}${openTag(node)}${inner}</${node.name}>`);
      return;
    }
  }

  out.push(`${ind}${openTag(node)}`);
  for (const child of meaningfulChildren(node)) {
    appendNode(child, out, depth + 1, ctx);
  }
  out.push(`${ind}</${node.name}>`);
}

// ─── Blank line post-processing ───────────────────────────────────────────────

function applyBlankLines(lines: string[], ctx: Ctx): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const next = i < lines.length - 1 ? lines[i + 1].trim() : null;

    result.push(lines[i]);

    // Always: blank line after XML declaration
    if (lines[i].startsWith("<?")) {
      result.push("");
      continue;
    }

    if (ctx.blankLines === "few") continue;

    if (ctx.blankLines === "some") {
      if (cur.startsWith("</") && next !== null && next.startsWith("<")) {
        const nextTag = /^<([^\s>/]+)/.exec(next)?.[1];
        if (nextTag && newlineTags.includes(nextTag)) result.push("");
      } else if (/^<title[\s>]/.test(cur)) {
        result.push("");
      }
    } else if (ctx.blankLines === "many") {
      if (
        cur.startsWith("</") ||
        (cur.startsWith("<") && next !== null && next.startsWith("<"))
      ) {
        result.push("");
      }
    }
  }

  return result;
}

// ─── Inline serialization ─────────────────────────────────────────────────────

function inlineSerialize(children: ElementContent[]): string {
  return children
    .map((c) => {
      if (c.type === "text") return escText((c as any).value);
      if (c.type === "element") return inlineEl(c as Element);
      if (c.type === "comment") return `<!--${(c as any).value}-->`;
      if (c.type === "cdata") return `<![CDATA[${(c as any).value}]]>`;
      return "";
    })
    .join("");
}

function inlineEl(node: Element): string {
  if (isEmptyElement(node)) return selfClose(node);
  return `${openTag(node)}${inlineSerialize(node.children)}</${node.name}>`;
}

// ─── Token collection and reflow ──────────────────────────────────────────────

function collectTokens(children: ElementContent[]): string[] {
  const tokens: string[] = [];
  for (const c of children) {
    if (c.type === "text") {
      const words: string[] = (c as any).value
        .split(/\s+/)
        .filter((w: string) => w.length > 0);
      for (let j = 0; j < words.length; j++) {
        const w = escText(words[j]);
        // Merge leading punctuation with the previous token to avoid "token ," artifacts
        if (j === 0 && tokens.length > 0 && /^[.,;:!?]/.test(w)) {
          tokens[tokens.length - 1] += w;
        } else {
          tokens.push(w);
        }
      }
    } else if (c.type === "element") {
      tokens.push(inlineEl(c as Element));
    } else if (c.type === "comment") {
      tokens.push(`<!--${(c as any).value}-->`);
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
  const width = Math.max(20, printWidth - indentLen);
  const lines: string[] = [];
  let cur = "";

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (cur === "") {
      cur = tok;
    } else if (cur.length + 1 + tok.length <= width) {
      cur += " " + tok;
    } else {
      lines.push(cur);
      cur = tok;
    }
    if (breakSentences && /[.!?]$/.test(tok) && i < tokens.length - 1) {
      lines.push(cur);
      cur = "";
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
  return Object.entries(node.attributes || {})
    .map(([k, v]) => (v == null ? k : `${k}="${escAttr(v)}"`))
    .join(" ");
}

// ─── Predicates ───────────────────────────────────────────────────────────────

function isEmptyElement(node: Element): boolean {
  return node.children.every(
    (c) => c.type === "text" && (c as any).value.trim() === "",
  );
}

function meaningfulChildren(node: Element): ElementContent[] {
  return node.children.filter(
    (c) => !(c.type === "text" && (c as any).value.trim() === ""),
  );
}

function isBlockChild(child: ElementContent): boolean {
  if (child.type !== "element") return false;
  const name = (child as Element).name;
  // <c> is verbatim but always inline; don't treat it as a block child
  if (name === "c") return false;
  return (
    (blockTags.includes(name) || verbatimTags.includes(name)) &&
    !lineEndTags.includes(name)
  );
}

function hasBlockChildren(node: Element): boolean {
  return node.children.some((c) => isBlockChild(c));
}

// ─── Text escaping ────────────────────────────────────────────────────────────

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
