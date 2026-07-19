import { parseString } from "xml2js";
import * as path from "path";
import type { Target } from "./types";

/** Default source directory the `pretext` CLI assumes when a v2 manifest omits it. */
const DEFAULT_SOURCE_DIR = "source";
/** Default source file name a target assumes when it declares none. */
const DEFAULT_TARGET_SOURCE = "main.ptx";

/**
 * Pull the text out of an xml2js-parsed child element, which may be a bare
 * string (`["source/main.ptx"]`) or an object with attributes
 * (`[{ _: "…", $: {…} }]`). Returns undefined when the element is absent.
 */
function childText(value: any): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null) {
    return undefined;
  }
  if (typeof first === "string") {
    return first.trim();
  }
  if (typeof first === "object" && typeof first._ === "string") {
    return first._.trim();
  }
  return undefined;
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
  target: any,
  projectRoot: string,
  sourceDir: string,
): string {
  const child = childText(target.source);
  if (child !== undefined) {
    return path.resolve(projectRoot, child);
  }
  const attr = target.$?.source as string | undefined;
  if (attr !== undefined) {
    return path.resolve(projectRoot, sourceDir, attr);
  }
  return path.resolve(projectRoot, sourceDir, DEFAULT_TARGET_SOURCE);
}

/**
 * Parse the `<targets>` out of a `project.ptx` manifest.
 *
 * This is the pure, filesystem-free core of target discovery: given the raw
 * XML text of a manifest and the project root it lives in, return the list of
 * targets. Separated from `project.ts` so it can be unit tested without the
 * `vscode` API.
 *
 * A target counts as `standalone` when its `standalone` attribute is present
 * and not equal to `"no"`.
 */
export function parseTargetsFromManifest(
  contents: string,
  projectRoot: string,
): Target[] {
  let targets: Target[] = [];
  // parseString invokes its callback synchronously when given a string.
  parseString(contents, (err, result) => {
    if (err) {
      console.error("Error parsing project.ptx XML: ", err);
      return;
    }
    if (
      result?.project &&
      result.project.targets &&
      result.project.targets[0]?.target
    ) {
      const sourceDir =
        (result.project.$?.source as string | undefined) ?? DEFAULT_SOURCE_DIR;
      targets = result.project.targets[0].target.map((t: any) => ({
        name: t.$?.name,
        path: projectRoot,
        standalone: (t.$?.standalone && t.$.standalone !== "no") || false,
        // v2 manifests carry the format as an attribute; legacy v1 manifests
        // use a `<format>` child element (xml2js exposes it as an array).
        format: t.$?.format ?? childText(t.format) ?? "",
        // Absolute path to the target's main source file (for the project-wide
        // outline, which follows its xi:includes).
        source: resolveTargetSource(t, projectRoot, sourceDir),
      }));
    }
  });
  return targets;
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
  // parseString invokes its callback synchronously when given a string.
  parseString(contents, (err, result) => {
    if (err) {
      console.error("Error parsing project.ptx XML: ", err);
      return;
    }
    const project = result?.project;
    if (!project) {
      return;
    }
    const sourceDir =
      (project.$?.source as string | undefined) ?? DEFAULT_SOURCE_DIR;
    const targets = project.targets?.[0]?.target;
    if (Array.isArray(targets) && targets.length > 0) {
      for (const t of targets) {
        sources.add(resolveTargetSource(t, projectRoot, sourceDir));
      }
      return;
    }
    // Legacy (pre-`<targets>`) manifests: a single project-level `<source>`
    // element, resolved directly against the project root.
    const legacy = childText(project.source);
    if (legacy !== undefined) {
      sources.add(path.resolve(projectRoot, legacy));
    }
  });
  if (sources.size === 0) {
    sources.add(
      path.resolve(projectRoot, DEFAULT_SOURCE_DIR, DEFAULT_TARGET_SOURCE),
    );
  }
  return [...sources];
}
