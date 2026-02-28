import { Position, Range } from "vscode-languageserver/node";

function positionCharShift(position: Position, shift?: number): Position {
  return {
    line: position.line,
    character: position.character + (shift || 0),
  };
}

export function rangeInLine(
  position: Position,
  startShift?: number,
  endShift?: number,
): Range {
  return {
    start: positionCharShift(position, startShift),
    end: positionCharShift(position, endShift),
  };
}

export function linePrefix(text: string, position: Position): string {
  const lines = text.split(/\r?\n/);
  const lineText = lines[position.line] || "";
  return lineText.slice(0, position.character);
}

export function getTextInRange(text: string, range: Range): string {
  const lines = text.split(/\r?\n/);
  if (range.start.line !== range.end.line) {
    return "";
  }
  const lineText = lines[range.start.line] || "";
  return lineText.slice(range.start.character, range.end.character);
}

export function getCurrentTag(
  text: string,
  position: Position,
): string | undefined {
  const lines = text.split(/\r?\n/);
  const beforeCursor =
    lines.slice(0, position.line).join("\n") +
    (position.line > 0 ? "\n" : "") +
    (lines[position.line] || "").slice(0, position.character);

  const allTags = (beforeCursor.match(/<(\w)+(?![^>]*\/>)|<\/\w+/g) || []).map(
    (tag) => tag.slice(1),
  );

  const openTagStack: string[] = [];
  for (const tag of allTags) {
    if (tag.startsWith("/")) {
      const lastOpenTag = openTagStack.pop();
      if (lastOpenTag !== tag.slice(1)) {
        continue;
      }
    } else {
      openTagStack.push(tag);
    }
  }

  return openTagStack.pop();
}
