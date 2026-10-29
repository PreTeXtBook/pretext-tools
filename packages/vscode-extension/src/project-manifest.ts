import { fromXml } from "xast-util-from-xml";
import { toString } from "xast-util-to-string";
import type { Element, Node, Root } from "xast";
import * as path from "path";
import type { Target } from "./types";

/** Default source directory the `pretext` CLI assumes when a v2 manifest omits it. */
const DEFAULT_SOURCE_DIR = "source";
/** Default source file name a target assumes when it declares none. */
const DEFAULT_TARGET_SOURCE = "main.ptx";
/** Default publication directory the `pretext` CLI assumes when a manifest omits it. */
const DEFAULT_PUBLICATION_DIR = "publication";
/** Default publication file name a target assumes when it declares none. */
const DEFAULT_TARGET_PUBLICATION = "publication.ptx";

/**
 * Parse a manifest into its `<project>` element, or undefined when the text
 * is not well-formed XML or has no `<project>` root. Uses xast (already in
 * the language server bundle and free of Node built-ins, unlike xml2js) so
 * the same resolver runs in the browser host.
 */
function parseProject(contents: string): Element | undefined {
  let tree: Root;
  try {
    tree = fromXml(contents);
  } catch (err) {
    console.error("Error parsing project.ptx XML: ", err);
    return undefined;
  }
  return childElements(tree).find((el) => el.name === "project");
}

function childElements(node: Root | Element, name?: string): Element[] {
  return (node.children as Node[]).filter(
    (child): child is Element =>
      child.type === "element" &&
      (name === undefined || (child as Element).name === name),
  );
}

/** Trimmed text of the first child element called `name`, if present. */
function childText(parent: Element, name: string): string | undefined {
  const child = childElements(parent, name)[0];
  return child ? toString(child).trim() : undefined;
}

function attr(el: Element, name: string): string | undefined {
  const value = el.attributes?.[name];
  return value === null || value === undefined ? undefined : value;
}

/**
 * Resolve a target's source file to an absolute path, applying the same
 * conventions as the `pretext` CLI:
 *  - a `<source>` *child element* holds a path relative to the project root
 *    (it typically already includes the `source/` directory);
 *  - a `source` *attribute* holds a path relative to the project's source
 *    directory (the project-level `source` attribute, default `"source"`);
 *  - when neither is present, the target defaults to `<sourceDir>/main.ptx`.
 */
function resolveTargetSource(
  target: Element,
  projectRoot: string,
  sourceDir: string,
): string {
  const child = childText(target, "source");
  if (child !== undefined) {
    return path.resolve(projectRoot, child);
  }
  const attribute = attr(target, "source");
  if (attribute !== undefined) {
    return path.resolve(projectRoot, sourceDir, attribute);
  }
  return path.resolve(projectRoot, sourceDir, DEFAULT_TARGET_SOURCE);
}

/**
 * Resolve a target's publication file to an absolute path, by the same
 * conventions as {@link resolveTargetSource}: a `<publication>` child element
 * is relative to the project root, a `publication` attribute to the
 * project's publication directory (project-level attribute, default
 * `"publication"`), and a target naming neither gets
 * `<publicationDir>/publication.ptx`. Existence is the caller's business.
 */
function resolveTargetPublication(
  target: Element,
  projectRoot: string,
  publicationDir: string,
): string {
  const child = childText(target, "publication");
  if (child !== undefined) {
    return path.resolve(projectRoot, child);
  }
  const attribute = attr(target, "publication");
  if (attribute !== undefined) {
    return path.resolve(projectRoot, publicationDir, attribute);
  }
  return path.resolve(projectRoot, publicationDir, DEFAULT_TARGET_PUBLICATION);
}

/**
 * Parse the `<targets>` out of a `project.ptx` manifest.
 *
 * This is the pure, filesystem-free core of target discovery: given the raw
 * XML text of a manifest and the project root it lives in, return the list of
 * targets. Separated from `project.ts` so it can be unit tested without the
 * `vscode` API.
 *
 * A target counts as `standalone` when its `standalone` attribute is present,
 * non-empty, and not equal to `"no"`.
 */
export function parseTargetsFromManifest(
  contents: string,
  projectRoot: string,
): Target[] {
  const project = parseProject(contents);
  if (!project) {
    return [];
  }
  const sourceDir = attr(project, "source") ?? DEFAULT_SOURCE_DIR;
  const publicationDir =
    attr(project, "publication") ?? DEFAULT_PUBLICATION_DIR;
  const targets = childElements(project, "targets")[0];
  if (!targets) {
    return [];
  }
  return childElements(targets, "target").map((t) => {
    const standalone = attr(t, "standalone");
    return {
      name: attr(t, "name") as string,
      path: projectRoot,
      standalone: !!standalone && standalone !== "no",
      // v2 manifests carry the format as an attribute; legacy v1 manifests
      // use a `<format>` child element.
      format: attr(t, "format") ?? childText(t, "format") ?? "",
      // Absolute path to the target's main source file (for the project-wide
      // outline, which follows its xi:includes).
      source: resolveTargetSource(t, projectRoot, sourceDir),
      // Likewise its publication file (for the live preview).
      publication: resolveTargetPublication(t, projectRoot, publicationDir),
    };
  });
}

/**
 * Resolve the absolute paths to every distinct target source file declared in a
 * `project.ptx` manifest — the "root documents" of a book, from which whole-book
 * schema validation follows `xi:include`s.
 *
 * This shares the exact source-resolution conventions of
 * `parseTargetsFromManifest` (`<source>` child element vs. `source` attribute vs.
 * default), so the LSP validator and the extension-host outline can never
 * disagree on where a project's book root lives. It additionally handles two
 * cases `parseTargetsFromManifest` doesn't model as targets:
 *  - very old manifests with a single project-level `<source>` element and no
 *    `<targets>` (resolved against the project root);
 *  - the ultimate fallback of `<sourceDir>/main.ptx` when a manifest declares no
 *    source at all.
 */
export function resolveRootSourcesFromManifest(
  contents: string,
  projectRoot: string,
): string[] {
  const sources = new Set<string>();
  const project = parseProject(contents);
  if (project) {
    const sourceDir = attr(project, "source") ?? DEFAULT_SOURCE_DIR;
    const targets = childElements(project, "targets")[0];
    const targetList = targets ? childElements(targets, "target") : [];
    if (targetList.length > 0) {
      for (const t of targetList) {
        sources.add(resolveTargetSource(t, projectRoot, sourceDir));
      }
    } else {
      // Legacy (pre-`<targets>`) manifests: a single project-level `<source>`
      // element, resolved directly against the project root.
      const legacy = childText(project, "source");
      if (legacy !== undefined) {
        sources.add(path.resolve(projectRoot, legacy));
      }
    }
  }
  if (sources.size === 0) {
    sources.add(
      path.resolve(projectRoot, DEFAULT_SOURCE_DIR, DEFAULT_TARGET_SOURCE),
    );
  }
  return [...sources];
}
