// Resolves and inlines `\input{…}` / `\include{…}` across an uploaded set of
// LaTeX files. Extracted from upload.ts so the upload analyzer can ask the
// same question the expander answers — "which files does this root pull in?"
// — without performing the expansion.

import { dirname, joinPath, normalizePath } from "../project/paths";

const INPUT_RE = /(\\(input|include) *\{([^{}]+)\})/g;

/**
 * Resolve an `\input{…}` argument against the uploaded file set, trying the
 * path as given, with `.tex` appended, and relative to the including file's
 * directory.
 */
export function resolveInputTarget(
  requestedPath: string,
  baseFile: string,
  texFiles: Record<string, string>,
): string | null {
  const baseDirectory = dirname(baseFile);
  const candidates = [
    requestedPath,
    `${requestedPath}.tex`,
    baseDirectory ? joinPath(baseDirectory, requestedPath) : requestedPath,
    baseDirectory
      ? joinPath(baseDirectory, `${requestedPath}.tex`)
      : `${requestedPath}.tex`,
  ].map(normalizePath);

  return candidates.find((candidate) => candidate in texFiles) ?? null;
}

export interface TexExpansion {
  expandedText: string;
  expandedCount: number;
  missingInputs: string[];
  /** Paths whose contents were inlined — they are parts, not roots. */
  consumedPaths: string[];
}

export function expandTexInputs(
  mainTex: string,
  baseFile: string,
  texFiles: Record<string, string>,
  maxPasses = 3,
): TexExpansion {
  let expandedCount = 0;
  const missingInputs: string[] = [];
  const consumed = new Set<string>();

  const expandOnce = (text: string): { output: string; changed: boolean } => {
    let changed = false;
    const output = text.replace(
      INPUT_RE,
      (match: string, _directive: string, _kind: string, requested: string) => {
        const target = resolveInputTarget(requested, baseFile, texFiles);
        if (!target) {
          if (!missingInputs.includes(requested)) {
            missingInputs.push(requested);
          }
          return match;
        }
        if (consumed.has(target)) {
          // Re-including the same file would loop on a self-referential set.
          return "";
        }
        changed = true;
        expandedCount += 1;
        consumed.add(target);
        return texFiles[target];
      },
    );

    return { output, changed };
  };

  let current = mainTex;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { output, changed } = expandOnce(current);
    current = output;
    if (!changed) {
      break;
    }
  }

  return {
    expandedText: current,
    expandedCount,
    missingInputs,
    consumedPaths: [...consumed],
  };
}

/**
 * Every `.tex` file that some other `.tex` file `\input`s — i.e. the files
 * that are parts of a larger document rather than roots in their own right.
 */
export function collectTexInputTargets(
  texFiles: Record<string, string>,
): Set<string> {
  const included = new Set<string>();
  for (const [path, contents] of Object.entries(texFiles)) {
    INPUT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INPUT_RE.exec(contents)) !== null) {
      const target = resolveInputTarget(match[3], path, texFiles);
      if (target && target !== path) {
        included.add(target);
      }
    }
  }
  return included;
}
