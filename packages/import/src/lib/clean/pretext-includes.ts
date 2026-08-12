// Inlines <xi:include href="..."/> references within a PreTeXt document.
// Modeled on expandTexInputs in upload.ts.

import { dirname, joinPath, normalizePath } from "../project/paths";

const XI_INCLUDE_RE =
  /<xi:include\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*\/>/g;

export function resolveIncludeTarget(
  requested: string,
  baseFile: string,
  files: Record<string, string>,
): string | null {
  const baseDir = dirname(baseFile);
  const candidates = [
    requested,
    `${requested}.ptx`,
    `${requested}.xml`,
    baseDir ? joinPath(baseDir, requested) : null,
    baseDir ? joinPath(baseDir, `${requested}.ptx`) : `${requested}.ptx`,
    baseDir ? joinPath(baseDir, `${requested}.xml`) : `${requested}.xml`,
  ].filter((c): c is string => c !== null);

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    if (normalized in files) {
      return normalized;
    }
  }
  return null;
}

// Strip the XML prolog (`<?xml ...?>`) and any leading whitespace; included
// fragments should not introduce a second prolog when inlined.
function stripXmlProlog(content: string): string {
  return content.replace(/^\s*<\?xml[^?]*\?>\s*/, "");
}

export interface PretextIncludeExpansion {
  expandedText: string;
  expandedCount: number;
  missingIncludes: string[];
  /** Paths whose contents were inlined — they are parts, not roots. */
  consumedPaths: string[];
}

export function expandPretextIncludes(
  mainContent: string,
  baseFile: string,
  files: Record<string, string>,
  maxDepth = 5,
): PretextIncludeExpansion {
  let expandedCount = 0;
  const missingIncludes: string[] = [];
  const visitStack: string[] = [];
  const consumed = new Set<string>();

  const expandOnce = (
    text: string,
    currentBase: string,
  ): { output: string; changed: boolean } => {
    let changed = false;
    const output = text.replace(
      XI_INCLUDE_RE,
      (whole: string, dq?: string, sq?: string) => {
        const requested = dq ?? sq ?? "";
        const target = resolveIncludeTarget(requested, currentBase, files);
        if (!target) {
          if (!missingIncludes.includes(requested)) {
            missingIncludes.push(requested);
          }
          return whole;
        }
        if (visitStack.includes(target)) {
          // Cycle: leave the include in place.
          return whole;
        }
        changed = true;
        expandedCount += 1;
        consumed.add(target);
        return stripXmlProlog(files[target]);
      },
    );
    return { output, changed };
  };

  let current = mainContent;
  for (let pass = 0; pass < maxDepth; pass += 1) {
    visitStack.push(baseFile);
    const { output, changed } = expandOnce(current, baseFile);
    visitStack.pop();
    current = output;
    if (!changed) {
      break;
    }
  }

  return {
    expandedText: current,
    expandedCount,
    missingIncludes,
    consumedPaths: [...consumed],
  };
}

/**
 * Every `.ptx`/`.xml` file that some other file `xi:include`s — i.e. the files
 * that are parts of a larger document rather than roots in their own right.
 */
export function collectPretextIncludeTargets(
  files: Record<string, string>,
): Set<string> {
  const included = new Set<string>();
  for (const [path, contents] of Object.entries(files)) {
    XI_INCLUDE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = XI_INCLUDE_RE.exec(contents)) !== null) {
      const requested = match[1] ?? match[2] ?? "";
      const target = resolveIncludeTarget(requested, path, files);
      if (target && target !== path) {
        included.add(target);
      }
    }
  }
  return included;
}

const PTX_ROOT_RE = /<(pretext|book|article)\b/;

export function findLikelyMainPretextPath(
  files: Record<string, string>,
): string | null {
  const candidates = Object.keys(files)
    .filter((p) => /\.(ptx|xml)$/i.test(p))
    .sort();

  if (candidates.length === 0) {
    return null;
  }

  const withRoot = candidates.find((p) => PTX_ROOT_RE.test(files[p]));
  return withRoot ?? candidates[0];
}
