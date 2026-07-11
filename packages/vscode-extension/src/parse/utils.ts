import { visit } from "unist-util-visit";
import { Range } from "vscode-languageserver-textdocument";
import { Element, Node } from "xast";

type Position = Element["position"] & {};

export function isElement(node: any): node is Element {
  if (node && typeof node === "object" && node.type === "element") {
    return true;
  }

  return false;
}
export function unifiedPositionToLspPosition(uPos: Element["position"]): Range {
  if (!uPos) {
    return {
      start: {
        line: 0,
        character: 0,
      },
      end: {
        line: 0,
        character: 0,
      },
    };
  }

  return {
    start: {
      line: uPos.start.line - 1,
      character: uPos.start.column - 1,
    },
    end: {
      line: uPos.end.line - 1,
      character: uPos.end.column - 1,
    },
  };
}

/**
 * Given `origSource` which has start and end positions maked by `origPosition`,
 * find the position of the substring that occurs `start` characters in and ends
 * after `end` characters (relative to `origSource`).
 */
export function positionOfSubstring(
  start: number,
  end: number,
  origPosition: Position,
  origSource: string,
): Position {
  let startLineOffset = 0;
  let startColOffset = 0;

  let startBound = Math.min(start, origSource.length);
  for (let i = 0; i < startBound; i++) {
    if (origSource.charAt(i) === "\n") {
      startLineOffset += 1;
      startColOffset = 0;
    } else {
      startColOffset += 1;
    }
  }

  let endLineOffset = startLineOffset;
  let endColOffset = startColOffset;
  let endBound = Math.min(end, origSource.length);
  for (let i = startBound; i < endBound; i++) {
    if (origSource.charAt(i) === "\n") {
      endLineOffset += 1;
      endColOffset = 0;
    } else {
      endColOffset += 1;
    }
  }

  return {
    start: {
      line: origPosition.start.line + startLineOffset,
      column:
        startLineOffset > 0
          ? startColOffset + 1
          : origPosition.start.column + startColOffset,
    },
    end: {
      line: origPosition.start.line + endLineOffset,
      column:
        startLineOffset > 0
          ? endColOffset + 1
          : origPosition.start.column + endColOffset,
    },
  };
}

/**
 * Grabs the nearest element to the cursor position, if there is one.
 */
export function elementAtOffset(offset: number, ast: Node): Element | null {
  let ret: Element | null = null;
  visit(ast, (node) => {
    if (!isElement(node)) {
      return;
    }
    const low = node.position?.start.offset || 0;
    const hi = node.position?.end.offset || 0;
    if (!ret && offset >= low && offset <= hi) {
      ret = node;
      return;
    }
    if (
      ret &&
      nodeHasSmallerRange(ret, node) &&
      offset >= low &&
      offset <= hi
    ) {
      ret = node;
      return;
    }
  });
  return ret;
}

/**
 * Determine if `inner` is nested in `outer`.
 */
function nodeHasSmallerRange(outer: Node, inner: Node): boolean {
  if (!outer.position || !inner.position) {
    return false;
  }
  return (
    (outer.position.start.offset || 0) < (inner.position.start.offset || 0) ||
    (outer.position.end.offset || 0) > (inner.position.end.offset || 0)
  );
}
