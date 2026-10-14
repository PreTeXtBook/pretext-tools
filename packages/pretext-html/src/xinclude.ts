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
import { readSource as hostReadSource } from "./host.js";
import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root, RootContent, Text } from "xast";
import type { SourceCache } from "./source-cache.js";

const XINCLUDE_NS = "http://www.w3.org/2001/XInclude";
const MAX_DEPTH = 64;

/**
 * How a file the document refers to is read: by absolute, normalized path
 * (as `path.resolve` spells it on the platform — posix in the browser build),
 * returning its text, or `undefined` for a file that does not exist.
 *
 * Lets a host that holds its project in memory — a browser editor, an
 * extension with unsaved buffers — supply files without a filesystem.
 * Returning `undefined` falls through to the host platform's own read (the
 * disk under Node, an absolute URL in the browser), so a reader can also just
 * overlay a few files on top of what is there.
 */
export type SourceReader = (
  file: string,
) => Promise<string | undefined> | string | undefined;

/** Options shared by everything that resolves includes. */
export interface ResolveOptions {
  /** See {@link SourceReader}. */
  readSource?: SourceReader;
  /** Reuse parses of unchanged files across calls (see source-cache.ts). */
  cache?: SourceCache;
}

/**
 * Read a file through the caller's reader first, then the platform's.
 */
export async function readWith(
  options: ResolveOptions | undefined,
  file: string,
): Promise<string | undefined> {
  const custom = options?.readSource
    ? await options.readSource(file)
    : undefined;
  return custom ?? (await hostReadSource(file));
}

interface ResolveContext extends ResolveOptions {
  /** Includes must stay inside this directory. */
  projectDir: string;
  /** Chain of files currently being processed, for cycle/err reporting. */
  stack: string[];
  /** Every file read so far, in the order first seen. */
  files: string[];
  /** Total length of everything read so far. */
  bytes: number;
}

/** Parse `content` as the file at `key`, through the cache when there is one. */
function parseWith(
  context: ResolveOptions,
  key: string,
  content: string,
): Root {
  return context.cache ? context.cache.parse(key, content) : fromXml(content);
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
  options?: ResolveOptions,
): Promise<string> {
  if (!sourceContent.includes("include")) {
    return sourceContent; // fast path: nothing that could be an include
  }
  return (
    await resolveXIncludesToTree(sourceContent, sourcePath, projectDir, options)
  ).content;
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
  /**
   * Every file the document spans — the source itself first, then each
   * xi:included file in the order first reached. What a host should watch
   * for changes that affect this document.
   */
  files: string[];
  /**
   * Total length of those files' contents: the size of the merged document,
   * near enough, without serializing it.
   */
  bytes: number;
}

/**
 * Like resolveXIncludes, but also return the merged tree with per-file
 * position attribution, for source-map computation.
 */
export async function resolveXIncludesToTree(
  sourceContent: string,
  sourcePath: string,
  projectDir: string,
  options: ResolveOptions = {},
): Promise<ResolvedTree> {
  const rootPath = path.resolve(sourcePath);
  const tree = parseWith(options, rootPath, sourceContent);
  const context: ResolveContext = {
    ...options,
    projectDir: path.resolve(projectDir),
    stack: [rootPath],
    files: [rootPath],
    bytes: sourceContent.length,
  };
  const changed = await resolveInTree(
    tree,
    path.dirname(rootPath),
    { "": "" },
    context,
  );
  return {
    tree,
    content: changed ? toXml(tree) : sourceContent,
    files: context.files,
    bytes: context.bytes,
  };
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

/** Record that `element` was parsed from `file` (see includedFileOf). */
export function tagIncludedFile(element: Element, file: string): void {
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

  const content = await readWith(context, target);
  if (content === undefined) {
    const fallback = findFallback(include, bindings);
    if (fallback) {
      await resolveInTree(fallback, baseDir, bindings, context);
      return fallback.children;
    }
    throw new Error(`xi:include target not found: ${href} (in ${currentFile})`);
  }
  if (!context.files.includes(target)) {
    context.files.push(target);
  }
  context.bytes += content.length;

  if (include.attributes["parse"] === "text") {
    const text: Text = { type: "text", value: content };
    return [text];
  }

  let subtree: Root;
  try {
    subtree = parseWith(context, target, content);
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
  options: ResolveOptions = {},
): Promise<string | undefined> {
  try {
    const rootPath = path.resolve(mainPath);
    const tree = parseWith(options, rootPath, mainContent);
    const root = tree.children.find(
      (node): node is Element => node.type === "element",
    );
    if (!root) {
      return undefined;
    }
    const baseDir = path.dirname(rootPath);
    const context: ResolveContext = {
      ...options,
      projectDir: path.resolve(projectDir),
      stack: [rootPath],
      files: [rootPath],
      bytes: mainContent.length,
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
