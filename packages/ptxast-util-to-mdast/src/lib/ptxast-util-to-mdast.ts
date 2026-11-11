/**
 * @pretextbook/ptxast-util-to-mdast
 *
 * Public API for converting an xast Root (PreTeXt document) to mdast and markdown.
 */

import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import type { Handle } from "mdast-util-to-markdown";
import { directiveToMarkdown } from "mdast-util-directive";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { mathToMarkdown } from "mdast-util-math";
import type { Heading, Root as MdastRoot } from "mdast";
import type { ElementContent, Root } from "@pretextbook/ptxast";
import { ptxastToMdast, findTopLevelDivisionInfo } from "./ptxast-to-mdast.js";

export { ptxastToMdast } from "./ptxast-to-mdast.js";

interface HeadingAttributes {
  id?: string;
  attributes?: Record<string, string>;
}

/**
 * The default heading handler, plus the heading's attributes:
 * `## Title {#id label="x"}`. The outermost division is left out, since its
 * attributes go in the frontmatter instead.
 */
function headingWithAttributes(outermost: Heading | undefined): Handle {
  return (node, parent, state, info) => {
    const heading = defaultHandlers.heading(node, parent, state, info);
    const data = (node as Heading).data as HeadingAttributes | undefined;
    if (!data?.id || node === outermost) return heading;
    const rest = Object.entries(data.attributes ?? {}).map(
      ([name, value]) => ` ${name}="${value}"`,
    );
    return `${heading} {#${data.id}${rest.join("")}}`;
  };
}

/**
 * Convert an xast Root (PreTeXt document) to a markdown string using the directive
 * syntax for PreTeXt block environments.
 *
 * A leading frontmatter block is prepended when the outermost division
 * carries information that markdown can't otherwise represent: a
 * `division:` field when it isn't `chapter` (the default a depth-1 heading
 * is assumed to mean), and `xmlid:`/`label:`/`component:` fields mirroring
 * that division's `xml:id`/`label`/`component` attributes.
 */
export function ptxastToMarkdown(root: Root): string {
  const mdast: MdastRoot = ptxastToMdast(root);
  const outermost = mdast.children.find((node) => node.type === "heading");
  const body = toMarkdown(mdast, {
    extensions: [directiveToMarkdown(), mathToMarkdown(), gfmTableToMarkdown()],
    handlers: { heading: headingWithAttributes(outermost as Heading) },
  });

  const topLevel = findTopLevelDivisionInfo(root.children as ElementContent[]);
  if (!topLevel) return body;

  const lines: string[] = [];
  if (topLevel.name !== "chapter") lines.push(`division: ${topLevel.name}`);
  if (topLevel.attributes.xmlid)
    lines.push(`xmlid: ${topLevel.attributes.xmlid}`);
  if (topLevel.attributes.label)
    lines.push(`label: ${topLevel.attributes.label}`);
  if (topLevel.attributes.component)
    lines.push(`component: ${topLevel.attributes.component}`);
  if (lines.length === 0) return body;

  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
