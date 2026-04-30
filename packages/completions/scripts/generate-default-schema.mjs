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
  "extension",
  "assets",
  "schema",
  "pretext-dev.rng",
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
const ptxastTypesPath = path.join(
  workspaceRoot,
  "packages",
  "ptxast",
  "src",
  "types",
  "index.ts",
);

function getAst(rngPath) {
  let rngFile = fs.readFileSync(rngPath, "utf8");
  const includeRegex = /<include\s+href=("|')(.*?)\1\s*\/>/g;
  let match = includeRegex.exec(rngFile);

  while (match !== null) {
    const rngDir = path.dirname(rngPath);
    const includePath = path.join(rngDir, match[2]);
    let includeContent = fs.readFileSync(includePath, "utf8");
    includeContent = includeContent.replace(/<\?xml.*?\?>/, "");
    rngFile = rngFile.replace(match[0], includeContent);
    match = includeRegex.exec(rngFile);
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
    const resolvedElement = { ...elements[elem] };
    if (!resolvedElement.refs) {
      continue;
    }

    while (resolvedElement.refs.length > 0) {
      const ref = resolvedElement.refs.pop();
      if (ref && aliases[ref]) {
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
        aliasMap[nodeName] = deepmerge(aliasMap[nodeName] || {}, getChildren(node));
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
  const sortedNames = Object.keys(elementChildren).sort((a, b) => a.localeCompare(b));
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

function extractCuratedElementNames(typesSource) {
  const matches = [...typesSource.matchAll(/type:\s*'([^']+)'/g)];
  return [...new Set(matches.map((match) => match[1]))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function main() {
  const schemaAst = getAst(schemaPath);
  const elementChildren = createSchemaElementChildren(schemaAst);
  const sortedElementChildren = sortSchemaElementChildren(elementChildren);
  const ptxastTypesSource = fs.readFileSync(ptxastTypesPath, "utf8");
  const curatedElementNames = extractCuratedElementNames(ptxastTypesSource);
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

// Generated by packages/completions/scripts/generate-default-schema.mjs from extension/assets/schema/pretext-dev.rng.
// Do not edit manually.
export const defaultDevSchema: CompletionSchema = {
  elementChildren: ${JSON.stringify(sortedElementChildren, null, 2)}
};
`;

  const ptxastContent = `// Generated by packages/completions/scripts/generate-default-schema.mjs from extension/assets/schema/pretext-dev.rng.
// Do not edit manually.
export const ptxSchemaElementChildren = ${JSON.stringify(sortedElementChildren, null, 2)} as const;

export const ptxCuratedElementNames = ${JSON.stringify(curatedSchemaElementNames, null, 2)} as const;

export const ptxUnmodeledSchemaElementNames = ${JSON.stringify(unmodeledSchemaElementNames, null, 2)} as const;

export type GeneratedPtxElementName = keyof typeof ptxSchemaElementChildren;
export type GeneratedPtxCuratedElementName = typeof ptxCuratedElementNames[number];
export type GeneratedPtxUnmodeledSchemaElementName =
  typeof ptxUnmodeledSchemaElementNames[number];
export type GeneratedPtxAttributeName = ${[
    ...new Set(
      Object.values(sortedElementChildren).flatMap((entry) => entry.attributes),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => JSON.stringify(name))
    .join(" | ") || "never"};
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
