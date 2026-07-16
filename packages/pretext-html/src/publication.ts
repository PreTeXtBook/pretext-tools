/**
 * Publication-file handling for single-page preview builds.
 *
 * The preview relies on PreTeXt's "portable HTML" mode
 * (`<html><platform portable="yes"/></html>` in the publication file), which
 * forces chunk level 0 (the whole document on one page), serves css/js from
 * the jsDelivr CDN, and suppresses most auxiliary file output. Publisher
 * variables can only come from a publication file — there is no stringparam
 * for `portable` — so we rewrite the user's publication file (or synthesize a
 * minimal one) and serve it through the fetch shim as a virtual file.
 */

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root } from "xast";

const MINIMAL_PUBLICATION = `<?xml version="1.0" encoding="UTF-8"?>
<publication>
  <source>
    <directories external="../assets" generated="../generated-assets" />
  </source>
  <html>
    <platform portable="yes"/>
  </html>
</publication>
`;

function findChildElement(
  parent: Root | Element,
  name: string,
): Element | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.name === name) {
      return child;
    }
  }
  return undefined;
}

function ensureChildElement(parent: Root | Element, name: string): Element {
  let child = findChildElement(parent, name);
  if (!child) {
    child = { type: "element", name, attributes: {}, children: [] };
    parent.children.push(child);
  }
  return child;
}

/**
 * Return publication-file XML with `<html><platform portable="yes"/></html>`
 * forced, preserving everything else from `publicationXml` when given.
 */
export function forcePortablePublication(publicationXml?: string): string {
  if (!publicationXml) {
    return MINIMAL_PUBLICATION;
  }
  const tree = fromXml(publicationXml);
  const publication = findChildElement(tree, "publication");
  if (!publication) {
    throw new Error(
      "Invalid publication file: no root <publication> element found",
    );
  }
  const html = ensureChildElement(publication, "html");
  const platform = ensureChildElement(html, "platform");
  platform.attributes = { ...platform.attributes, portable: "yes" };
  return toXml(tree);
}
