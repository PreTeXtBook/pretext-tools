/**
 * Project-wide outline: follow `xi:include`s to assemble the outline of a whole
 * PreTeXt project, not just the active file.
 *
 * Pure (no `vscode` import) so it can be unit tested with an in-memory file map.
 * The driver in `documentOutline.ts` supplies a `readFile` that prefers unsaved
 * editor content and attaches VS Code `Uri`s afterwards.
 */

import * as path from "path";
import { OutlineItem, parseOutline } from "./outline-parser";

/** An {@link OutlineItem} annotated with the file it was parsed from. */
export interface FileOutlineItem extends OutlineItem {
  /** Absolute path of the file this item lives in (for cross-file navigation). */
  file: string;
  children: FileOutlineItem[];
}

/** Reads a file's text, or returns undefined if it can't be read. */
export type ReadFile = (absPath: string) => Promise<string | undefined>;

/**
 * Parse `entryFile` and recursively splice in the outlines of every file it
 * pulls in via `xi:include`, returning a single tree annotated with each item's
 * source file.
 *
 * Include cycles are broken (a file already on the current include chain is not
 * re-entered), and an `xi:include` whose target can't be read becomes a
 * `(missing: …)` leaf rather than throwing.
 */
export async function parseProjectOutline(
  entryFile: string,
  readFile: ReadFile,
): Promise<FileOutlineItem[]> {
  const text = await readFile(entryFile);
  if (text === undefined) {
    return [missingItem(entryFile, entryFile, 0, 0)];
  }
  const items = parseOutline(text, { includeXInclude: true });
  return expandItems(items, entryFile, readFile, new Set([entryFile]));
}

async function expandItems(
  items: OutlineItem[],
  currentFile: string,
  readFile: ReadFile,
  chain: Set<string>,
): Promise<FileOutlineItem[]> {
  const result: FileOutlineItem[] = [];
  for (const item of items) {
    if (item.tag === "xi:include") {
      const href = item.href ?? "";
      if (!href) {
        continue;
      }
      const target = path.resolve(path.dirname(currentFile), href);
      if (chain.has(target)) {
        // Include cycle — don't recurse (silently, as the user's XML is fine;
        // it's our flattening that would otherwise loop).
        continue;
      }
      const text = await readFile(target);
      if (text === undefined) {
        result.push(missingItem(href, currentFile, item.line, item.character));
        continue;
      }
      const parsed = parseOutline(text, { includeXInclude: true });
      const expanded = await expandItems(
        parsed,
        target,
        readFile,
        new Set(chain).add(target),
      );
      // Splice the included file's top-level items in where the include was.
      result.push(...expanded);
    } else {
      const children = await expandItems(
        item.children,
        currentFile,
        readFile,
        chain,
      );
      result.push({ ...item, file: currentFile, children });
    }
  }
  return result;
}

/** A leaf standing in for an `xi:include` whose target file can't be read. */
function missingItem(
  href: string,
  file: string,
  line: number,
  character: number,
): FileOutlineItem {
  const name = href.split(/[\\/]/).pop() || href;
  return {
    tag: "missing",
    title: `(missing: ${name})`,
    xmlId: "",
    href,
    line,
    character,
    file,
    children: [],
  };
}
