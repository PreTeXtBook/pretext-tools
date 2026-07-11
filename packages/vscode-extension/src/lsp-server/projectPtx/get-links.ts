import { visit, EXIT } from "unist-util-visit";
import {
  DocumentLink,
  DocumentSymbol,
  SymbolKind,
} from "vscode-languageserver/node";
import { toString } from "xast-util-to-string";
import {
  isElement,
  positionOfSubstring,
  unifiedPositionToLspPosition,
} from "../../parse/utils";
import { getDocumentInfo } from "../state";
import { Element } from "xast";

type Position = Element["position"];

const LINK_CONTENT_NODES = new Set(["xsl", "source", "publication"]);

function findLinkPosition(node: Element): Position {
  const textNode = node.children[0];
  if (
    node.children.length !== 1 ||
    !textNode ||
    textNode.type !== "text" ||
    !textNode.position
  ) {
    return node.position;
  }
  const text = textNode.value;
  const len = text.length;
  const start = len - text.trimStart().length;
  const end = text.trimEnd().length;

  const origPos = textNode.position;
  const newPos = positionOfSubstring(start, end, origPos, text);

  return newPos;
}

/**
 * Return all the linkable items in a project.ptx file.
 */
export async function getProjectPtxLinks(uri: string): Promise<DocumentLink[]> {
  const info = getDocumentInfo(uri);
  if (!info) {
    console.warn("Requested project symbols for uninitialized file", uri);
    return [];
  }
  const ast = await info.ast;
  if (!ast) {
    // There could be no AST because the document was malformed, so this isn't neccessarily an error.
    return [];
  }
  const links: Element[] = [];

  visit(ast, (node, index, parent) => {
    if (!isElement(node)) {
      return;
    }

    if (LINK_CONTENT_NODES.has(node.name)) {
      links.push(node);
    }
  });

  // We convert into DocumentSymbol type.
  return links.map((n) => ({
    range: unifiedPositionToLspPosition(findLinkPosition(n)),
    target: "" + new URL(toString(n), uri),
    tooltip: `${n.name} file at ${toString(n)}`,
  }));
}
