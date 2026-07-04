import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { FileReader } from "./types";

/** Where a line in the merged document originated. */
export interface OriginEntry {
  /** URI of the source file this line came from. */
  uri: string;
  /** 0-based line number within that source file. */
  line: number;
  /** Number of characters prepended to this line during merging (column shift). */
  columnShift: number;
}

/** A problem with an `xi:include` element itself (missing target, cycle). */
export interface IncludeProblem {
  kind: "xinclude-missing" | "xinclude-circular";
  message: string;
  /** URI of the file containing the offending include. */
  uri: string;
  /** 0-based line of the include element. */
  line: number;
  /** 0-based start column of the include element. */
  column: number;
  /** Length of the matched include element text. */
  length: number;
}

export interface ResolvedDocument {
  /** The inlined document text with all includes expanded. */
  text: string;
  /** Per-line origin, indexed by 0-based line in {@link text}. */
  origin: OriginEntry[];
  /** Problems encountered resolving includes. */
  problems: IncludeProblem[];
}

const XINCLUDE_RE =
  /<xi:include\b[^>]*?\bhref\s*=\s*("|')(.*?)\1[^>]*?\/>/;

/** Default reader backed by Node's `fs`. */
export function defaultFileReader(): FileReader {
  // Lazy require so bundlers targeting the browser don't choke.

  const fs = require("fs") as typeof import("fs");
  return (absolutePath: string) => {
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  };
}

function stripXmlDeclaration(text: string): { text: string; removedLines: number } {
  const match = text.match(/^﻿?\s*<\?xml\b.*?\?>/s);
  if (!match) {
    return { text, removedLines: 0 };
  }
  const removed = match[0];
  const removedLines = (removed.match(/\n/g) ?? []).length;
  return { text: text.slice(removed.length), removedLines };
}

/** Convert a document URI (file://...) or plain path to an absolute fs path. */
function uriToPath(uri: string): string {
  if (uri.startsWith("file:")) {
    return fileURLToPath(uri);
  }
  return uri;
}

function pathToUri(p: string): string {
  return pathToFileURL(p).toString();
}

/**
 * Expand every `xi:include` in `text`, producing a single merged document plus a
 * per-line origin map so validation errors in included content can be mapped
 * back to the file and line they actually came from.
 *
 * Handles nested includes and detects cycles and missing targets (reported as
 * {@link IncludeProblem}s rather than throwing).
 */
export function resolveXIncludes(
  text: string,
  documentUri: string,
  readFile: FileReader = defaultFileReader(),
): ResolvedDocument {
  const problems: IncludeProblem[] = [];

  function expand(
    source: string,
    uri: string,
    stack: string[],
  ): { lines: string[]; origin: OriginEntry[] } {
    const lines = source.split("\n");
    const outLines: string[] = [];
    const outOrigin: OriginEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = XINCLUDE_RE.exec(line);
      if (!match) {
        outLines.push(line);
        outOrigin.push({ uri, line: i, columnShift: 0 });
        continue;
      }

      const before = line.slice(0, match.index);
      const after = line.slice(match.index + match[0].length);
      const href = match[2];
      const baseDir = path.dirname(uriToPath(uri));
      const targetPath = path.resolve(baseDir, href);
      const targetUri = pathToUri(targetPath);

      // Any non-include text preceding the include stays on its own line,
      // still attributed to the including file.
      if (before.length > 0) {
        outLines.push(before);
        outOrigin.push({ uri, line: i, columnShift: 0 });
      }

      if (stack.includes(targetUri)) {
        problems.push({
          kind: "xinclude-circular",
          message: `Circular xi:include detected for "${href}".`,
          uri,
          line: i,
          column: match.index,
          length: match[0].length,
        });
      } else {
        const content = readFile(targetPath);
        if (content === undefined) {
          problems.push({
            kind: "xinclude-missing",
            message: `Cannot resolve xi:include target "${href}".`,
            uri,
            line: i,
            column: match.index,
            length: match[0].length,
          });
        } else {
          const stripped = stripXmlDeclaration(content);
          const sub = expand(stripped.text, targetUri, [...stack, targetUri]);
          for (let j = 0; j < sub.lines.length; j++) {
            outLines.push(sub.lines[j]);
            outOrigin.push(sub.origin[j]);
          }
        }
      }

      if (after.trim().length > 0) {
        outLines.push(after);
        outOrigin.push({ uri, line: i, columnShift: 0 });
      }
    }

    return { lines: outLines, origin: outOrigin };
  }

  const { lines, origin } = expand(text, documentUri, [documentUri]);
  return { text: lines.join("\n"), origin, problems };
}
