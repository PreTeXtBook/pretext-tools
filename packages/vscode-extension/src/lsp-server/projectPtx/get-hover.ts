import { Hover, HoverParams, MarkupKind } from "vscode-languageserver/node";
import { elementAtOffset } from "../../parse/utils";
import { documents, getDocumentInfo } from "../state";

/**
 * Return all the linkable items in a project.ptx file.
 */
export async function getProjectPtxHoverInfo(
  params: HoverParams,
): Promise<Hover | null> {
  const uri = params.textDocument.uri;
  const info = getDocumentInfo(uri);
  const doc = documents.get(uri);
  if (!info || !doc) {
    console.warn("Requested project symbols for uninitialized file", uri);
    return null;
  }
  const ast = await info.ast;
  if (!ast) {
    // There could be no AST because the document was malformed, so this isn't neccessarily an error.
    return null;
  }
  const offset = doc.offsetAt(params.position);
  const containingElm = elementAtOffset(offset, ast);
  if (!containingElm) {
    return null;
  }

  // We know what element we're contained in, but not whether we are hovering over the body
  // of the element or the actual tag hame.
  const slicedText = doc
    .getText()
    .slice(
      containingElm.position?.start.offset || 0,
      containingElm.position?.end.offset || 0,
    );
  // The first thing in our sliced text should be the opening tag, so we just search for the tag name.
  const tagOffsetStart = slicedText.indexOf(containingElm.name);
  const tagOffsetEnd = tagOffsetStart + containingElm.name.length;
  const relOffset = offset - (containingElm.position?.start.offset || 0);
  if (relOffset >= tagOffsetStart && relOffset < tagOffsetEnd) {
    // Only return a hover hint if we are hovering over the tag name.
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `Hovering over ${containingElm.name}`,
      },
    };
  }
  return null;
}
