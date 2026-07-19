import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fromXml } from "xast-util-from-xml";
import { CONTINUE, SKIP, visit } from "unist-util-visit";
import deepmerge from "deepmerge";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const schemaPath = path.join(
  workspaceRoot,
  "packages",
  "vscode-extension",
  "assets",
  "schema",
  "pretext.rng",
);
const outputPath = path.join(
  workspaceRoot,
  "packages",
  "completions",
  "src",
  "default-dev-schema.ts",
);
const ptxastOutputPath = path.join(
  workspaceRoot,
  "packages",
  "ptxast",
  "src",
  "types",
  "generated.ts",
);
// The curated element set is whatever the hand-written curated layer
// (`curated.ts`) gives a friendly type to — either inline (`Element & { name:
// "x" }`) or by aliasing a generated `ElementXxx` interface (whose element name
// lives in `generated-interfaces.ts`). Both files are needed to resolve it.
const ptxastCuratedPath = path.join(
  workspaceRoot,
  "packages",
  "ptxast",
  "src",
  "types",
  "curated.ts",
);
const ptxastInterfacesPath = path.join(
  workspaceRoot,
  "packages",
  "ptxast",
  "src",
  "types",
  "generated-interfaces.ts",
);

function getAst(rngPath) {
  let rngFile = fs.readFileSync(rngPath, "utf8");
  const includeRegex = /<include\s+href=("|')(.*?)\1\s*\/>/g;
  let match = includeRegex.exec(rngFile);
  let iterations = 0;
  const maxIterations = 100; // Prevent infinite loops on circular includes

  while (match !== null && iterations < maxIterations) {
    const rngDir = path.dirname(rngPath);
    const includePath = path.join(rngDir, match[2]);
    try {
      let includeContent = fs.readFileSync(includePath, "utf8");
      includeContent = includeContent.replace(/<\?xml.*?\?>/, "");
      rngFile = rngFile.replace(match[0], includeContent);
    } catch (err) {
      console.warn(`Failed to resolve include ${match[2]}: ${err.message}`);
      // Skip this include and move on
      includeRegex.lastIndex = 0;
      rngFile = rngFile.replace(match[0], "");
    }
    match = includeRegex.exec(rngFile);
    iterations++;
  }

  if (iterations >= maxIterations) {
    console.warn(
      `Warning: include resolution hit max iterations (${maxIterations}). File may have circular includes.`,
    );
  }

  return fromXml(rngFile);
}

function getChildren(elemNode) {
  if (
    elemNode.type !== "element" ||
    !elemNode.children ||
    elemNode.children.length === 0
  ) {
    return {};
  }

  const elements = [];
  const attributes = [];
  const refs = [];

  visit(elemNode, (node, _index, parent) => {
    if (!parent) {
      return CONTINUE;
    }

    if (node.name === "element") {
      if (node.attributes && node.attributes.name) {
        elements.push(node.attributes.name);
        return SKIP;
      }
    } else if (node.name === "attribute") {
      if (node.attributes && node.attributes.name) {
        attributes.push(node.attributes.name);
        return SKIP;
      }
    } else if (node.name === "ref") {
      if (node.attributes && node.attributes.name) {
        refs.push(node.attributes.name);
        return SKIP;
      }
    }

    return CONTINUE;
  });

  return { elements, attributes, refs };
}

function resolveRefs(elements, aliases) {
  const resolvedElements = {};

  for (const elem in elements) {
    const source = elements[elem];
    if (!source.refs) {
      continue;
    }

    // Work on copies so we don't mutate the shared alias/element arrays.
    const resolvedElement = {
      ...source,
      elements: [...source.elements],
      attributes: [...source.attributes],
      refs: [...source.refs],
    };

    // Track refs we've already expanded so mutually-recursive defines
    // (common in RNG grammars, e.g. paragraph -> list -> paragraph) don't
    // loop forever.
    const seenRefs = new Set();

    while (resolvedElement.refs.length > 0) {
      const ref = resolvedElement.refs.pop();
      if (ref && !seenRefs.has(ref) && aliases[ref]) {
        seenRefs.add(ref);
        resolvedElement.elements.push(...aliases[ref].elements);
        resolvedElement.attributes.push(...aliases[ref].attributes);
        if (aliases[ref].refs) {
          resolvedElement.refs.push(...aliases[ref].refs);
        }
      }
    }

    resolvedElement.elements = [...new Set(resolvedElement.elements)];
    resolvedElement.attributes = [...new Set(resolvedElement.attributes)];
    resolvedElement.refs = undefined;
    resolvedElements[elem] = resolvedElement;
  }

  return resolvedElements;
}

function createSchemaElementChildren(schemaAst) {
  const tmpElementChildren = {};
  const aliasMap = {};

  visit(schemaAst, (node) => {
    if (node.type === "root") {
      return CONTINUE;
    }
    if (node.type !== "element") {
      return SKIP;
    }

    if (node.name === "start") {
      return SKIP;
    }

    if (node.name === "define") {
      const nodeName = node.attributes?.name;
      if (nodeName) {
        aliasMap[nodeName] = deepmerge(
          aliasMap[nodeName] || {},
          getChildren(node),
        );
      }
    } else if (node.name === "element") {
      const nodeName = node.attributes?.name;
      if (nodeName) {
        tmpElementChildren[nodeName] = deepmerge(
          tmpElementChildren[nodeName] || {},
          getChildren(node),
        );
      }
    }

    return CONTINUE;
  });

  return resolveRefs(tmpElementChildren, aliasMap);
}

function sortSchemaElementChildren(elementChildren) {
  const sortedNames = Object.keys(elementChildren).sort((a, b) =>
    a.localeCompare(b),
  );
  const sorted = {};

  for (const name of sortedNames) {
    sorted[name] = {
      elements: [...elementChildren[name].elements].sort((a, b) =>
        a.localeCompare(b),
      ),
      attributes: [...elementChildren[name].attributes].sort((a, b) =>
        a.localeCompare(b),
      ),
    };
  }

  return sorted;
}

/**
 * Map every generated `ElementXxx` interface to its PreTeXt element name, e.g.
 * `ElementSection` -> `"section"`, `ElementParagraph` -> `"p"`. Each interface
 * declares its name as the first member: `export interface ElementSection
 * extends XMLElement { name: "section"; ... }`.
 */
function buildInterfaceNameToElementName(interfacesSource) {
  const map = new Map();
  const re =
    /export interface (Element[A-Za-z0-9_]+)\s+extends[^{]*\{\s*name:\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(interfacesSource)) !== null) {
    map.set(match[1], match[2]);
  }
  return map;
}

/**
 * Derive the curated element names from the hand-written curated layer
 * (`curated.ts`): every element it names inline (`name: "x"`) plus every element
 * it aliases via a generated `ElementXxx` interface. This is the post-xast-
 * rewrite source of truth for "curated" — the friendly, hand-modeled subset —
 * as opposed to schema elements that only exist as generated interfaces.
 */
function extractCuratedElementNames(curatedSource, interfacesSource) {
  const interfaceNameToElement =
    buildInterfaceNameToElementName(interfacesSource);
  const names = new Set();
  for (const match of curatedSource.matchAll(/name:\s*"([^"]+)"/g)) {
    names.add(match[1]);
  }
  for (const match of curatedSource.matchAll(/\bElement[A-Za-z0-9_]+\b/g)) {
    const elementName = interfaceNameToElement.get(match[0]);
    if (elementName !== undefined) {
      names.add(elementName);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function main() {
  const schemaAst = getAst(schemaPath);
  const elementChildren = createSchemaElementChildren(schemaAst);
  const sortedElementChildren = sortSchemaElementChildren(elementChildren);
  const curatedSource = fs.readFileSync(ptxastCuratedPath, "utf8");
  const interfacesSource = fs.readFileSync(ptxastInterfacesPath, "utf8");
  const curatedElementNames = extractCuratedElementNames(
    curatedSource,
    interfacesSource,
  );
  const schemaElementNames = Object.keys(sortedElementChildren);
  const schemaElementNameSet = new Set(schemaElementNames);
  const curatedSchemaElementNames = curatedElementNames.filter((name) =>
    schemaElementNameSet.has(name),
  );
  const curatedSchemaElementNameSet = new Set(curatedSchemaElementNames);
  const unmodeledSchemaElementNames = schemaElementNames.filter(
    (name) => !curatedSchemaElementNameSet.has(name),
  );

  const content = `import type { CompletionSchema } from "./types";

// Generated by packages/completions/scripts/generate-default-schema.mjs from extension/assets/schema/pretext.rng.
// Do not edit manually.
export const defaultDevSchema: CompletionSchema = {
  elementChildren: ${JSON.stringify(sortedElementChildren, null, 2)}
};
`;

  const ptxastContent = `// Generated by packages/completions/scripts/generate-default-schema.mjs from extension/assets/schema/pretext.rng.
// Do not edit manually.
export const ptxSchemaElementChildren = ${JSON.stringify(sortedElementChildren, null, 2)} as const;

export const ptxCuratedElementNames = ${JSON.stringify(curatedSchemaElementNames, null, 2)} as const;

export const ptxUnmodeledSchemaElementNames = ${JSON.stringify(unmodeledSchemaElementNames, null, 2)} as const;

export type GeneratedPtxElementName = keyof typeof ptxSchemaElementChildren;
export type GeneratedPtxCuratedElementName = typeof ptxCuratedElementNames[number];
export type GeneratedPtxUnmodeledSchemaElementName =
  typeof ptxUnmodeledSchemaElementNames[number];
export type GeneratedPtxAttributeName = ${
    [
      ...new Set(
        Object.values(sortedElementChildren).flatMap(
          (entry) => entry.attributes,
        ),
      ),
    ]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => JSON.stringify(name))
      .join(" | ") || "never"
  };
export type GeneratedPtxChildElementName<
  ElementName extends GeneratedPtxElementName,
> = (typeof ptxSchemaElementChildren)[ElementName]["elements"][number];
export type GeneratedPtxAttributeForElement<
  ElementName extends GeneratedPtxElementName,
> = (typeof ptxSchemaElementChildren)[ElementName]["attributes"][number];
`;

  fs.writeFileSync(outputPath, content);
  fs.writeFileSync(ptxastOutputPath, ptxastContent);
  console.log(`Wrote default schema to ${outputPath}`);
  console.log(`Wrote ptxast generated schema types to ${ptxastOutputPath}`);
}

main();
