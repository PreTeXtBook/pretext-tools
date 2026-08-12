import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromXml } from "xast-util-from-xml";
import type { Element } from "xast";
import {
  blockTags,
  lineEndTags,
  parTags,
  smartParTags,
  verbatimTags,
} from "./docStructure";

// Guards against the <strcmp> bug class (issue #252): a schema element whose
// content model is text-only, but which the formatter does not classify, falls
// through to appendBlock and gets its text re-indented onto its own line. For
// prose that is merely ugly; for code, regexes, or program input it silently
// changes what the document means.
//
// If a schema refresh makes this fail, classify the new tag in docStructure.ts:
//   - verbatimTags  when whitespace is significant (code, regex, literal data)
//   - lineEndTags   for short scalar values
//   - smartParTags  for prose that may need reflowing
// Only add to KNOWN_INLINE_ONLY if the tag can never appear outside inline text.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const schemaDir = join(
  __dirname,
  "..",
  "..",
  "..",
  "vscode-extension",
  "assets",
  "schema",
);
const schemaFiles = [
  "pretext.rng",
  "pretext-dev.rng",
  "publication-schema.rng",
];

const RNG_STRUCTURAL = new Set([
  "attribute",
  "name",
  "anyName",
  "nsName",
  "except",
  "param",
]);

/** Tags reachable only from inline text content, where inlineSerialize already
 *  preserves them exactly, so block classification is irrelevant. */
const KNOWN_INLINE_ONLY = new Set<string>([]);

function elementChildren(node: Element): Element[] {
  return node.children.filter((c): c is Element => c.type === "element");
}

function localName(node: Element): string {
  return node.name.replace(/^[^:]*:/, "");
}

/** Collect every <define> in a grammar, keyed by name (names may repeat when
 *  RELAX NG `combine` is used, so each key holds a list). */
function collectDefines(root: Element[]): Map<string, Element[]> {
  const defines = new Map<string, Element[]>();
  const visit = (node: Element) => {
    if (localName(node) === "define") {
      const name = node.attributes?.name;
      if (name) {
        const list = defines.get(name) ?? [];
        list.push(node);
        defines.set(name, list);
      }
    }
    elementChildren(node).forEach(visit);
  };
  root.forEach(visit);
  return defines;
}

/** What a node's content model can contain, resolving <ref> through <define>
 *  but never descending past a nested <element> boundary. */
function contentKinds(
  node: Element,
  defines: Map<string, Element[]>,
  seen: Set<string>,
): Set<string> {
  const kinds = new Set<string>();
  for (const child of elementChildren(node)) {
    const tag = localName(child);
    if (tag === "element") {
      kinds.add("element");
    } else if (tag === "text" || tag === "value" || tag === "data") {
      kinds.add("text");
    } else if (tag === "ref") {
      const name = child.attributes?.name;
      if (!name || seen.has(name)) continue;
      const next = new Set(seen).add(name);
      for (const def of defines.get(name) ?? []) {
        for (const k of contentKinds(def, defines, next)) kinds.add(k);
      }
    } else if (!RNG_STRUCTURAL.has(tag)) {
      for (const k of contentKinds(child, defines, seen)) kinds.add(k);
    }
  }
  return kinds;
}

function textOnlyElements(): string[] {
  const roots: Element[] = [];
  for (const file of schemaFiles) {
    const path = join(schemaDir, file);
    if (!existsSync(path)) continue;
    const tree = fromXml(readFileSync(path, "utf8"));
    roots.push(
      ...tree.children.filter((c): c is Element => c.type === "element"),
    );
  }
  if (roots.length === 0) return [];

  const defines = collectDefines(roots);
  const kindsByName = new Map<string, Set<string>>();
  const visit = (node: Element) => {
    if (localName(node) === "element") {
      const name = node.attributes?.name;
      if (name) {
        const kinds = kindsByName.get(name) ?? new Set<string>();
        for (const k of contentKinds(node, defines, new Set())) kinds.add(k);
        kindsByName.set(name, kinds);
      }
    }
    elementChildren(node).forEach(visit);
  };
  roots.forEach(visit);

  return [...kindsByName.entries()]
    .filter(([, kinds]) => kinds.size === 1 && kinds.has("text"))
    .map(([name]) => name)
    .sort();
}

describe("docStructure covers the schema", () => {
  const classified = new Set([
    ...blockTags,
    ...lineEndTags,
    ...parTags,
    ...smartParTags,
    ...verbatimTags,
  ]);

  it("finds the schemas", () => {
    expect(schemaFiles.some((f) => existsSync(join(schemaDir, f)))).toBe(true);
  });

  it("classifies every text-only element in the schema", () => {
    const unclassified = textOnlyElements().filter(
      (name) => !classified.has(name) && !KNOWN_INLINE_ONLY.has(name),
    );

    expect(unclassified).toEqual([]);
  });
});
