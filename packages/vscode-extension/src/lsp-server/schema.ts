import path from "path";
import fs from "fs";
import { fromXml } from "xast-util-from-xml";
import { CONTINUE, SKIP, visit } from "unist-util-visit";
import deepmerge from "deepmerge";
import { schemaDir } from "./main";

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
  let schemaPath = setSchema(schemaConfig);
  let schemaAst = getAst(schemaPath);
  return new Schema(schemaAst);
}

function setSchema(schemaConfig: { versionName: string; customPath: string }) {
  let schemaPath: string = schemaConfig.customPath;
  if (schemaPath !== "" && schemaConfig.versionName !== "Custom") {
    console.warn(
      "Custom schema path provided, but version is not set to Custom.  Ignoring custom path.",
    );
  }
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found at path: ${schemaPath}`);
    schemaPath = "";
  }
  if (schemaPath === "") {
    switch (schemaConfig.versionName) {
      case "Stable":
        schemaPath = path.join(schemaDir, "pretext.rng");
        break;
      case "Experimental":
        schemaPath = path.join(schemaDir, "pretext-dev.rng");
        break;
      case "Custom":
        console.log(
          "Selected custom schema, but no valid path provided.  Setting to default.",
        );
        schemaPath = path.join(schemaDir, "pretext.rng");
        break;
    }
  }
  return schemaPath;
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
      while (resolvedElement.refs.length > 0) {
        let ref = resolvedElement.refs.pop();
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
  }
  return resolvedElements;
}

export function getAst(rngPath: string) {
  let rngFile = fs.readFileSync(rngPath, "utf8");
  //Look for an "include" statement:
  let importRegex = /<include href=\"(.*?)\"\s*\/>/g;
  let match = importRegex.exec(rngFile);
  while (match !== null) {
    let rngDir = path.dirname(rngPath);
    let importPath = path.join(rngDir, match[1]);
    let importContent = fs.readFileSync(importPath, "utf8");
    //remove first line (xml declaration):
    importContent = importContent.replace(/<\?xml.*?\?>/, "");
    rngFile = rngFile.replace(match[0], importContent);
    match = importRegex.exec(rngFile);
  }
  return fromXml(rngFile);
}
