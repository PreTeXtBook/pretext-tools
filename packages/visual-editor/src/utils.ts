// Utilities for the visual editor

//export function addAttributes(){
//  return {
//    label: {
//      parseHTML: (element) => element.getAttribute("label"),
//    },
//    "xml:id": {
//      parseHTML: (element) => element.getAttribute("xml:id"),
//    }
//  }
//}
//import { formatPTX } from "../../src/formatter";

//export function cleanText(text: string) {
//  return formatPTX(text
//    .split("\n")
//    .map((line) => line.trim())
//    .join("\n"));
//}

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import { SKIP, visit } from "unist-util-visit";
import { whitespace } from "hast-util-whitespace";
import type { Element, ElementContent, Root, RootContent } from "xast";
import { wrappingInputRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { KNOWN_TAGS } from "./knownTags";

/**
 * Elements whose children live in INLINE text flow after TipTap parsing:
 * the paragraph itself, plus the mark elements (em/term/alert/c) whose DOM
 * children end up in the surrounding paragraph's flow. An unknown element
 * found inside one of these must be wrapped with the inline chip
 * (<rawptx-inline>) — the block <rawptx> wrapper would be illegal in
 * `inline*` content and ProseMirror would mangle it.
 *
 * Deliberately NOT in this set: title/m/me/md/url, whose editor content
 * model is `text*` — NO node wrapper (inline or block) can live inside
 * them. Math gets its own escalation rule below; unknown elements inside
 * title/url remain unsupported (the round-trip guard refuses those
 * documents rather than corrupting them).
 */
const INLINE_CONTEXT_TAGS = new Set(["p", "em", "term", "alert", "c"]);

/**
 * Math elements whose editor content model is text-only. Real PreTeXt
 * allows element children here (most importantly <md><mrow>…</mrow></md>),
 * which the text* model cannot represent — previously the mrows were
 * mangled into escaped text. The escalation rule: if one of these contains
 * ANY element child, wrap the WHOLE math element as raw source instead
 * (they sit in paragraph flow, so that is an inline chip). The math loses
 * its KaTeX rendering but round-trips verbatim; modeling <mrow> properly
 * is future coverage work.
 */
const TEXT_ONLY_MATH_TAGS = new Set(["m", "me", "md"]);

/**
 * Wrap a node the editor cannot represent in the appropriate rawptx
 * escape-hatch element. The original markup is serialized to a single text
 * child (toXml escapes it; the HTML parser unescapes it back to text inside
 * the editor node), and json2ptx later emits that text verbatim — so the
 * wrapped source survives the round-trip byte-for-byte (modulo the
 * formatter, which reformats it like any other part of the document).
 *
 * Works for any xast node kind: unknown elements, comments, CDATA
 * sections, and processing instructions all serialize cleanly via toXml.
 */
function wrapAsRaw(node: RootContent, inlineContext: boolean): Element {
  return {
    type: "element",
    name: inlineContext ? "rawptx-inline" : "rawptx",
    attributes: {},
    children: [{ type: "text", value: toXml(node) }],
  };
}

/**
 * Recursively replace everything the editor cannot faithfully represent
 * with rawptx wrappers, choosing the inline or block wrapper based on the
 * element's context (see INLINE_CONTEXT_TAGS). Children of a wrapped node
 * are never visited — their source is preserved wholesale inside the
 * wrapper.
 */
function cleanNode(node: RootContent, inlineContext: boolean): RootContent {
  if (node.type === "text") {
    return node;
  }
  if (node.type !== "element") {
    // Comments, CDATA sections, and processing instructions have no editor
    // representation, and TipTap's HTML parser would silently drop them.
    // Wrap them as raw source like any unknown element so authors' <!-- …
    // --> notes survive editing.
    return wrapAsRaw(node, inlineContext);
  }
  if (!KNOWN_TAGS.includes(node.name)) {
    return wrapAsRaw(node, inlineContext);
  }
  if (
    TEXT_ONLY_MATH_TAGS.has(node.name) &&
    node.children.some((child) => child.type !== "text")
  ) {
    // Known math element with non-text children — mrow elements, or even a
    // comment inside the LaTeX: its text* content model cannot hold them,
    // so preserve the whole thing as raw source. See TEXT_ONLY_MATH_TAGS
    // above.
    return wrapAsRaw(node, inlineContext);
  }
  return {
    ...node,
    children: node.children.map(
      (child) =>
        cleanNode(child, INLINE_CONTEXT_TAGS.has(node.name)) as ElementContent,
    ),
  };
}

/*
 * Clean up incoming PreTeXt source to ensure all tags are ones that the visual editor can handle.
 * Tags that are not recognized are wrapped with a placeholder — <rawptx> in
 * block positions, <rawptx-inline> inside paragraph text flow — that renders
 * back to the original source on serialization.
 */
export function cleanPtx(origXml: string) {
  // Always add the root <ptxdoc> tag to make sure the XML is well-formed.  The visual editor expects exactly this as the root element.
  let xml = origXml.trim();
  // remove xml declaration if present
  if (xml.startsWith("<?xml")) {
    const endDecl = xml.indexOf("?>");
    if (endDecl !== -1) {
      xml = xml.slice(endDecl + 2).trim();
    }
  }
  xml = `<ptxdoc>\n${xml}\n</ptxdoc>`;
  // We use xast to parse the XML into a AST.
  // NOTE: fromXml throws on malformed XML. That is intentional — callers that
  // need a non-throwing answer go through checkRoundTrip (roundtrip.ts), which
  // catches the error and reports the document as unsafe to edit.
  const tree = fromXml(xml);
  // Walk the tree, wrapping anything the editor cannot represent. The walk
  // starts in block context (the synthetic <ptxdoc> root holds divisions
  // and blocks).
  tree.children = tree.children.map((child) => cleanNode(child, false));
  // Convert the resulting tree back to XML
  const newXml = toXml(tree);
  return newXml;
}

export function ptxToJson(xml: string) {
  const tree = fromXml(xml);
  console.log(JSON.stringify(buildJsonFromTree(tree), null, 2));
  return JSON.stringify(buildJsonFromTree(tree), null, 2);
}

function buildJsonFromTree(tree: Root | RootContent) {
  let ret;
  visit(tree, (node) => {
    if (node.type === "root" && node.children) {
      ret = {
        type: "ptxFragment",
        content: node.children
          .filter((child) => buildJsonFromTree(child) !== undefined)
          .map((child) => buildJsonFromTree(child)),
      };
    } else if (node.type === "element") {
      ret = {
        type: node.name,
        attrs: node.attributes,
        content: node.children
          .filter((child) => buildJsonFromTree(child) !== undefined)
          .map((child) => buildJsonFromTree(child)),
      };
    } else if (node.type === "text" && !whitespace(node)) {
      ret = {
        type: "text",
        text: node.value.trim(),
      };
    }
    return SKIP;
  });
  return ret;
}

export function generateInputRules(prefix: string, nodeType: NodeType) {
  return [
    wrappingInputRule({
      find: new RegExp(`^#${prefix}\\s$`, "i"),
      type: nodeType,
    }),
    wrappingInputRule({
      find: new RegExp(`(?:^)(<${prefix}>(\\s))$`, "i"),
      type: nodeType,
    }),
    wrappingInputRule({
      find: new RegExp(`(?:^)(${prefix}:(\\s))$`, "i"),
      type: nodeType,
    }),
  ];
}
