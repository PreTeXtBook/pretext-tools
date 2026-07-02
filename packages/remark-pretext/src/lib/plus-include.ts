/**
 * PreTeXt Plus include conversion.
 *
 * PreTeXt Plus modularizes a document with `<plus:KIND ref="id" .../>`
 * placeholders — a section, chapter, image, or other asset pulled in from
 * elsewhere by reference (not transcluded here; a later assembly step expands
 * them). In this markdown dialect those includes are authored as a
 * remark-directive leaf directive:
 *
 *   ::section{ref="ch-intro"}
 *   ::image{ref="fig-1" width="50%"}
 *
 * which convert to:
 *
 *   <plus:section ref="ch-intro"/>
 *   <plus:image ref="fig-1" width="50%"/>
 *
 * Everything funnels through {@link plusIncludeElement}, the single builder for
 * a `plus:` element. Recognizing a *source pattern* (the leaf directive here,
 * or an inline text directive / image shorthand / ... later) is kept separate
 * from building the element, so a new authoring pattern only needs to map
 * itself to a `(kind, attributes)` pair and call the builder.
 */

import type { Element } from "xast";
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from "mdast-util-directive";

/** Any of the three remark-directive node shapes (`:x`, `::x`, `:::x`). */
type DirectiveNode = TextDirective | LeafDirective | ContainerDirective;

/**
 * Build a `<plus:KIND .../>` include element from a kind name and attributes.
 *
 * This is the one choke point every include syntax funnels through: the tag is
 * always `plus:<kind>`, the element is always empty (a reference, never
 * transcluded), and `null`/`undefined` attribute values are dropped so a
 * value-less directive attribute doesn't emit `key="null"`.
 */
export function plusIncludeElement(
  kind: string,
  attributes: Record<string, string | null | undefined> = {},
): Element {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    attrs[key] = value;
  }
  return {
    type: "element",
    name: `plus:${kind}`,
    attributes: attrs,
    children: [],
  };
}

/**
 * Interpret a remark-directive node as a PreTeXt Plus include: the directive
 * name becomes the `plus:` kind and its attributes pass through verbatim
 * (`::section{ref="x"}` → `<plus:section ref="x"/>`).
 *
 * Attributes are intentionally *not* remapped the way block directives remap
 * `id`→`xml:id`: an include points at another element by `ref`, so its
 * attributes are kept exactly as written.
 *
 * Returns `null` when the node carries no usable name, so callers can fall back
 * to their normal handling rather than emitting `<plus:/>`.
 */
export function directiveToPlusInclude(node: DirectiveNode): Element | null {
  const kind = node.name?.trim();
  if (!kind) return null;
  return plusIncludeElement(kind, node.attributes ?? {});
}
