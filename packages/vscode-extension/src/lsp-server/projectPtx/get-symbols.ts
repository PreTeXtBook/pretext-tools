import { visit, EXIT } from "unist-util-visit";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import { toString } from "xast-util-to-string";
import { isElement, unifiedPositionToLspPosition } from "../../parse/utils";
import { getDocumentInfo } from "../state";
import { Element } from "xast";

type Position = Element["position"] & {};

export async function getProjectPtxSymbols(
  uri: string,
): Promise<DocumentSymbol[]> {
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
  const targets: { name: string; format: string; position: Position }[] = [];

  visit(ast, (node, index, parent) => {
    if (!isElement(node)) {
      return;
    }
    if (node.name !== "targets") {
      return;
    }
    // We've found the <targets> section. Collect all the data we need from it.
    for (const t of node.children) {
      if (!isElement(t) || t.name !== "target" || !t.attributes) {
        continue;
      }
      const name = t.attributes["name"] || "<unknown target>";
      const formatNode = t.children.find(
        (c) => isElement(c) && c.name === "format",
      );
      const format = formatNode ? toString(formatNode) : "<unknown format>";
      const position: Position = t.position
        ? t.position
        : {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
          };
      targets.push({ format, position, name });
    }

    return EXIT;
  });

  console.log("targets", targets);
  // We convert into DocumentSymbol type.
  return targets.map((t) => ({
    kind: SymbolKind.Module,
    name: t.name,
    detail: `(${t.format})`,
    range: unifiedPositionToLspPosition(t.position),
    selectionRange: unifiedPositionToLspPosition(t.position),
  }));
}
