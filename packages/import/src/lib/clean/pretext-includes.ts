// Inlines <xi:include href="..."/> references within a PreTeXt document.
// Modeled on expandTexInputs in upload.ts.

const XI_INCLUDE_RE =
  /<xi:include\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*\/>/g;

function directoryOf(pathName: string): string {
  const slash = pathName.lastIndexOf("/");
  return slash >= 0 ? pathName.slice(0, slash) : "";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveIncludeTarget(
  requested: string,
  baseFile: string,
  files: Record<string, string>,
): string | null {
  const baseDir = directoryOf(baseFile);
  const candidates = [
    requested,
    `${requested}.ptx`,
    `${requested}.xml`,
    baseDir ? `${baseDir}/${requested}` : null,
    baseDir ? `${baseDir}/${requested}.ptx` : `${requested}.ptx`,
    baseDir ? `${baseDir}/${requested}.xml` : `${requested}.xml`,
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
  };
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
