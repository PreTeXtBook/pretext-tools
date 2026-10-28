import { fromXml } from "xast-util-from-xml";
import { CONTINUE, SKIP, visit } from "unist-util-visit";
import deepmerge from "deepmerge";
import { URI } from "vscode-uri";
import { assetUri, readUri, resolveUri } from "./assets";

type SchemaGroup = {
  [key: string]: {
    elements: string[];
    attributes: string[];
    refs?: string[];
  };
};

export async function initializeSchema(schemaConfig: {
  versionName: string;
  customPath: string;
}) {
  const schemaUri = await resolveSchemaUri(schemaConfig);
  const schemaAst = await getAst(schemaUri);
  return new Schema(schemaAst);
}

/**
 * The URI of the RELAX NG schema the configuration asks for: a custom file
 * when one is given and readable, else the bundled stable/experimental one.
 */
async function resolveSchemaUri(schemaConfig: {
  versionName: string;
  customPath: string;
}): Promise<string> {
  const customPath = schemaConfig.customPath;
  if (customPath !== "" && schemaConfig.versionName !== "Custom") {
    console.warn(
      "Custom schema path provided, but version is not set to Custom.  Ignoring custom path.",
    );
  }
  if (customPath !== "") {
    const customUri = URI.file(customPath).toString();
    if ((await readUri(customUri)) !== undefined) {
      return customUri;
    }
    console.error(`Schema file not found at path: ${customPath}`);
  }
  switch (schemaConfig.versionName) {
    case "Experimental":
      return assetUri("pretext-dev.rng");
    case "Custom":
      console.log(
        "Selected custom schema, but no valid path provided.  Setting to default.",
      );
      return assetUri("pretext.rng");
    default:
      return assetUri("pretext.rng");
  }
}

//Create a class for a pretext schema:
export class Schema {
  elementChildren: SchemaGroup;
  schema: any;
  constructor(schemaAst: any) {
    let tmpElementChildren: SchemaGroup = {};
    let aliasMap: SchemaGroup = {};
    // For some reason, removing the "text" nodes causes some elements to be skipped.  So even though it is slightly faster, commenting it out for now.
    //remove(schemaAst, { type: "text" });
    this.schema = schemaAst;
    //console.time("visit");
    visit(schemaAst, (node) => {
      if (node.type === "root") {
        return CONTINUE;
      }
      if (node.type !== "element") {
        return SKIP;
      }
      if (node.type === "element") {
        if (node.name === "start") {
          return SKIP;
        }
        if (node.name === "define") {
          let nodeName = node.attributes?.name;
          if (nodeName) {
            aliasMap[nodeName] = deepmerge(
              aliasMap[nodeName] || {},
              getChildren(node),
            );
          }
        } else if (node.name === "element") {
          let nodeName = node.attributes?.name;
          if (nodeName) {
            tmpElementChildren[nodeName] = deepmerge(
              tmpElementChildren[nodeName] || {},
              getChildren(node),
            );
          }
        }
      }
    });
    //console.timeEnd("visit");
    //console.time("resolve");
    this.elementChildren = resolveRefs(tmpElementChildren, aliasMap);
    //console.timeEnd("resolve");
  }
  getSchema() {
    return this.schema;
  }
}

function getChildren(elemNode: any) {
  if (
    elemNode.type !== "element" ||
    !elemNode.children ||
    elemNode.children.length === 0
  ) {
    //console.log("No children found for node: ", elemNode);
    return {};
  }
  let elements: string[] = [];
  let attributes: string[] = [];
  let refs: string[] = [];
  visit(elemNode, (node, index, parent) => {
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
  });
  return { elements: elements, attributes: attributes, refs: refs };
}

function resolveRefs(elements: SchemaGroup, aliases: SchemaGroup) {
  let resolvedElements: SchemaGroup = {};
  for (let elem in elements) {
    let resolvedElement = { ...elements[elem] };
    if (resolvedElement.refs) {
      // Track visited refs to prevent infinite loops caused by circular ref chains
      // in the schema (e.g. A → B → A). Without this, resolveRefs would push
      // previously-seen refs back onto the stack indefinitely, blocking the
      // Node.js event loop and silently breaking all LSP request handling.
      const visited = new Set<string>();
      while (resolvedElement.refs.length > 0) {
        let ref = resolvedElement.refs.pop();
        if (ref && aliases[ref] && !visited.has(ref)) {
          visited.add(ref);
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
  }
  return resolvedElements;
}

/** Bound on `<include>` expansions, so a self-including schema cannot spin. */
const MAX_INCLUDES = 64;

/**
 * Parse a RELAX NG schema (read by URI through the client, see assets.ts)
 * into a xast tree, inlining its `<include href="…"/>`s first, each resolved
 * relative to the schema that includes it.
 */
export async function getAst(rngUri: string) {
  let rngFile = await readUri(rngUri);
  if (rngFile === undefined) {
    throw new Error(`Could not read schema ${rngUri}`);
  }
  //Look for an "include" statement:
  const importRegex = /<include href=\"(.*?)\"\s*\/>/;
  let match = importRegex.exec(rngFile);
  for (let n = 0; match !== null && n < MAX_INCLUDES; n++) {
    const importUri = resolveUri(match[1], rngUri);
    let importContent = (await readUri(importUri)) ?? "";
    //remove first line (xml declaration):
    importContent = importContent.replace(/<\?xml.*?\?>/, "");
    rngFile = rngFile.replace(match[0], () => importContent);
    match = importRegex.exec(rngFile);
  }
  return fromXml(rngFile);
}
