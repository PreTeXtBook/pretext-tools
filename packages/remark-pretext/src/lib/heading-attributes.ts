/**
 * Attributes on a heading, written the way a directive takes them:
 * `## Title {#id label="x"}`.
 *
 * The braces have to come last and start with the `#id`, so a title that ends
 * in something like `{x=1}` isn't mistaken for them. Write `\{` for a title that
 * really does end in `{#id}`.
 */

import type { Heading, Root } from "mdast";
import { visit } from "unist-util-visit";

const ATTRIBUTE = /([\w:.-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'{}]+))/g;
const TRAILING_ATTRIBUTES = new RegExp(
  String.raw`\s*\{#([\w:.-]+)((?:\s+${ATTRIBUTE.source})*)\s*\}$`,
);

/** What a heading keeps in `data`, once its attributes are read. */
export interface HeadingAttributes {
  id?: string;
  attributes?: Record<string, string>;
}

function isEscaped(heading: Heading, source?: string): boolean {
  const { start, end } = heading.position ?? {};
  const raw = source?.slice(start?.offset, end?.offset) ?? "";
  return raw[raw.lastIndexOf("{") - 1] === "\\";
}

/** Move any trailing attributes out of each heading's text and into `data`. */
export function applyHeadingAttributes(tree: Root, source?: string): void {
  visit(tree, "heading", (heading: Heading) => {
    const last = heading.children[heading.children.length - 1];
    if (last?.type !== "text") return;
    const match = TRAILING_ATTRIBUTES.exec(last.value);
    if (!match || isEscaped(heading, source)) return;

    const attributes: Record<string, string> = {};
    for (const [, name, ...values] of match[2].matchAll(ATTRIBUTE)) {
      attributes[name] = values.find((value) => value !== undefined) ?? "";
    }
    heading.data = {
      ...heading.data,
      id: match[1],
      attributes,
    } as Heading["data"];

    last.value = last.value.slice(0, match.index);
    if (!last.value) heading.children.pop();
  });
}
