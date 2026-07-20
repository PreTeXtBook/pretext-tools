/**
 * JavaScript XInclude resolution.
 *
 * The libxslt-wasm build cannot run libxml2's own XInclude pass:
 * `xmlXIncludeProcessFlags` is not on the compile-time list of
 * JSPI-"promising" exports, so it traps with a SuspendError as soon as it
 * fetches an included file. (Fixable in a rebuild of libxslt-wasm; see the
 * package README.) Until then we resolve `<xi:include>` elements here, in JS,
 * before handing the document to the parser.
 *
 * Supported: `href` includes of well-formed XML files (recursively) and
 * `parse="text"` includes; `<xi:fallback>` when the target is missing.
 * Not supported: `xpointer` (rejected with a clear error).
 */

import * as path from "node:path";
import { readSource } from "./host.js";
import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root, RootContent, Text } from "xast";

const XINCLUDE_NS = "http://www.w3.org/2001/XInclude";
const MAX_DEPTH = 64;

interface ResolveContext {
  /** Includes must stay inside this directory. */
  projectDir: string;
  /** Chain of files currently being processed, for cycle/err reporting. */
  stack: string[];
}

/**
 * Return `sourceContent` with every xi:include replaced by the contents of
 * the referenced files. `sourcePath` anchors relative hrefs; `projectDir`
 * bounds which files may be included.
 */
export async function resolveXIncludes(
  sourceContent: string,
  sourcePath: string,
  projectDir: string,
): Promise<string> {
  if (!sourceContent.includes("include")) {
    return sourceContent; // fast path: nothing that could be an include
  }
  return (await resolveXIncludesToTree(sourceContent, sourcePath, projectDir))
    .content;
}

/** Result of resolveXIncludesToTree. */
export interface ResolvedTree {
  /**
   * The merged xast tree. Every node keeps the line/column position of its
   * OWN source file's parse, and the root element of each spliced-in subtree
   * is tagged with that file (see includedFileOf) — together, enough to map
   * any element back to a file and line (see computeSourceMap).
   */
  tree: Root;
  /** The merged document serialized, as resolveXIncludes would return it. */
  content: string;
}

/**
 * Like resolveXIncludes, but also return the merged tree with per-file
 * position attribution, for source-map computation.
 */
export async function resolveXIncludesToTree(
  sourceContent: string,
  sourcePath: string,
  projectDir: string,
): Promise<ResolvedTree> {
  const tree = fromXml(sourceContent);
  const context: ResolveContext = {
    projectDir: path.resolve(projectDir),
    stack: [path.resolve(sourcePath)],
  };
  const changed = await resolveInTree(
    tree,
    path.dirname(path.resolve(sourcePath)),
    { "": "" },
    context,
  );
  return { tree, content: changed ? toXml(tree) : sourceContent };
}

/**
 * File a spliced-in element was parsed from, tagged by expandInclude.
 * Undefined for nodes of the file being resolved (callers track that file
 * themselves). Stored on the unist `data` field, which serializers ignore.
 */
export function includedFileOf(element: Element): string | undefined {
  return (element.data as { ptxIncludedFile?: string } | undefined)
    ?.ptxIncludedFile;
}

function tagIncludedFile(element: Element, file: string): void {
  const data = (element.data ?? (element.data = {})) as {
    ptxIncludedFile?: string;
  };
  data.ptxIncludedFile = file;
}

/** Prefix → namespace URI bindings in scope. */
type NsBindings = Record<string, string>;

function bindingsWithElement(
  bindings: NsBindings,
  element: Element,
): NsBindings {
  let extended = bindings;
  for (const [attr, value] of Object.entries(element.attributes)) {
    if (attr === "xmlns" || attr.startsWith("xmlns:")) {
      if (extended === bindings) {
        extended = { ...bindings };
      }
      extended[attr === "xmlns" ? "" : attr.slice(6)] = value ?? "";
    }
  }
  return extended;
}

function isXInclude(element: Element, bindings: NsBindings): boolean {
  const colon = element.name.indexOf(":");
  const prefix = colon === -1 ? "" : element.name.slice(0, colon);
  const local = colon === -1 ? element.name : element.name.slice(colon + 1);
  return local === "include" && bindings[prefix] === XINCLUDE_NS;
}

async function resolveInTree(
  parent: Root | Element,
  baseDir: string,
  bindings: NsBindings,
  context: ResolveContext,
): Promise<boolean> {
  let changed = false;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.type !== "element") {
      continue;
    }
    const childBindings = bindingsWithElement(bindings, child);
    if (isXInclude(child, childBindings)) {
      const replacement = await expandInclude(
        child,
        baseDir,
        childBindings,
        context,
      );
      parent.children.splice(i, 1, ...replacement);
      i += replacement.length - 1;
      changed = true;
    } else if (await resolveInTree(child, baseDir, childBindings, context)) {
      changed = true;
    }
  }
  return changed;
}

async function expandInclude(
  include: Element,
  baseDir: string,
  bindings: NsBindings,
  context: ResolveContext,
): Promise<RootContent[]> {
  const currentFile = context.stack[context.stack.length - 1];
  if (include.attributes["xpointer"]) {
    throw new Error(
      `xi:include with xpointer is not supported by the JS preview build ` +
        `(in ${currentFile})`,
    );
  }
  const href = include.attributes["href"];
  if (!href) {
    throw new Error(`xi:include without href (in ${currentFile})`);
  }

  // hrefs are URIs: percent-decode before touching the filesystem (but stay
  // lenient about raw values that are not valid URI encodings).
  let decodedHref = href;
  try {
    decodedHref = decodeURIComponent(href);
  } catch {
    // use the raw value
  }
  const target = path.resolve(baseDir, decodedHref);
  if (
    target !== context.projectDir &&
    !target.startsWith(context.projectDir + path.sep)
  ) {
    throw new Error(
      `xi:include escapes the project directory: ${href} (in ${currentFile})`,
    );
  }
  if (context.stack.includes(target)) {
    throw new Error(
      `Circular xi:include: ${[...context.stack, target].join(" -> ")}`,
    );
  }
  if (context.stack.length >= MAX_DEPTH) {
    throw new Error(`xi:include nesting exceeds ${MAX_DEPTH} levels`);
  }

  const content = await readSource(target);
  if (content === undefined) {
    const fallback = findFallback(include, bindings);
    if (fallback) {
      await resolveInTree(fallback, baseDir, bindings, context);
      return fallback.children;
    }
    throw new Error(`xi:include target not found: ${href} (in ${currentFile})`);
  }

  if (include.attributes["parse"] === "text") {
    const text: Text = { type: "text", value: content };
    return [text];
  }

  let subtree: Root;
  try {
    subtree = fromXml(content);
  } catch (error) {
    throw new Error(
      `Could not parse xi:include target ${target} as XML: ` +
        `${error instanceof Error ? error.message : error}. ` +
        `(Included files must be well-formed, with a single root element.)`,
    );
  }
  context.stack.push(target);
  try {
    await resolveInTree(subtree, path.dirname(target), { "": "" }, context);
  } finally {
    context.stack.pop();
  }
  // Splice in the elements (skipping prolog comments/PIs), mirroring
  // libxml2's behavior of replacing the include with the document element.
  // Tag each with its origin file: their positions are from `target`'s own
  // parse, which is exactly what source-map attribution needs.
  const elements = subtree.children.filter(
    (node): node is Element => node.type === "element",
  );
  for (const element of elements) {
    tagIncludedFile(element, target);
  }
  return elements;
}

/** True for an unprefixed <docinfo> element (PreTeXt uses no namespace). */
function isDocinfo(element: Element): boolean {
  return element.name === "docinfo";
}

/**
 * Extract the `<docinfo>` element from a complete PreTeXt source file as an XML
 * string, resolving xi:includes along the way. Handles the two shapes authors
 * actually write: a literal `<docinfo>` (whose children may themselves be
 * xi:included — e.g. a factored-out macros file), and a top-level
 * `<xi:include href="docinfo.ptx"/>` standing in for the whole docinfo.
 *
 * Only the docinfo is resolved: scanning stops at the document element
 * (<book>/<article>/…), which `<docinfo>` must precede, so the book's chapter
 * includes are never read. Best-effort — returns undefined when there is no
 * docinfo, or if resolution fails (a fragment preview without the project
 * macros beats a failed render). `mainPath` anchors relative hrefs;
 * `projectDir` bounds which files may be read.
 */
export async function extractDocinfo(
  mainContent: string,
  mainPath: string,
  projectDir: string,
): Promise<string | undefined> {
  try {
    const tree = fromXml(mainContent);
    const root = tree.children.find(
      (node): node is Element => node.type === "element",
    );
    if (!root) {
      return undefined;
    }
    const rootPath = path.resolve(mainPath);
    const baseDir = path.dirname(rootPath);
    const context: ResolveContext = {
      projectDir: path.resolve(projectDir),
      stack: [rootPath],
    };
    const rootBindings = bindingsWithElement({ "": "" }, root);
    for (const child of root.children) {
      if (child.type !== "element") {
        continue;
      }
      const childBindings = bindingsWithElement(rootBindings, child);
      if (isDocinfo(child)) {
        // A literal <docinfo>; resolve any includes nested inside it.
        await resolveInTree(child, baseDir, childBindings, context);
        return toXml(child);
      }
      if (isXInclude(child, childBindings)) {
        // <docinfo> pulled in via xi:include (with its own nested includes
        // resolved relative to the included file by expandInclude).
        const expanded = await expandInclude(
          child,
          baseDir,
          childBindings,
          context,
        );
        const docinfo = expanded.find(
          (node): node is Element => node.type === "element" && isDocinfo(node),
        );
        if (docinfo) {
          return toXml(docinfo);
        }
        // Some other include before the document element — keep scanning.
        continue;
      }
      // The document element (<book>/<article>/…). <docinfo> must come first,
      // so there is none; stop before touching chapter includes.
      break;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function findFallback(
  include: Element,
  bindings: NsBindings,
): Element | undefined {
  for (const child of include.children) {
    if (child.type !== "element") {
      continue;
    }
    const childBindings = bindingsWithElement(bindings, child);
    const colon = child.name.indexOf(":");
    const prefix = colon === -1 ? "" : child.name.slice(0, colon);
    const local = colon === -1 ? child.name : child.name.slice(colon + 1);
    if (local === "fallback" && childBindings[prefix] === XINCLUDE_NS) {
      return child;
    }
  }
  return undefined;
}
