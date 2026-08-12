// Surveys an uploaded file set *before* anything is converted: which files
// could serve as the document root, what formats are on offer, and which one
// the pipeline will pick unless the user says otherwise.
//
// Hosts use this to drive their own UI (a format dropdown, a main-file picker,
// a list of extra roots to attach) and then feed the answers back in as
// `ImportProjectOptions`. The pipeline itself calls it too, so the choice
// shown to the user and the choice actually made are computed by one function.

import { extractLatexField } from "../clean/latex-preamble";
import {
  collectTexInputTargets,
  resolveInputTarget,
} from "../clean/latex-includes";
import { collectPretextIncludeTargets } from "../clean/pretext-includes";
import { detectSourceFormat } from "../detect-source-format";
import { findFirstElement } from "../layout/xml-scan";
import type { SourceFormat } from "../types";
import {
  defaultManifestTarget,
  findProjectManifest,
  type ProjectManifest,
} from "./manifest";
import { basename, extension, joinPath, stem } from "./paths";

/** Why a file is offered as a possible document root. */
export type RootReason =
  | "manifest-target"
  | "latex-root"
  | "pretext-root"
  | "markdown-root"
  | "fallback";

export interface RootCandidate {
  /** Path within the uploaded file set. */
  path: string;
  format: SourceFormat;
  reason: RootReason;
  /** Title mined from the file, when it declares one. */
  title?: string;
  /** `project.ptx` target this candidate came from. */
  targetName?: string;
  /** That target's output format (`html`, `pdf`, …). */
  targetFormat?: string;
}

export interface UploadAnalysis {
  /** The `project.ptx` governing the upload, when it has one. */
  manifest: ProjectManifest | null;
  /** Every file that could serve as a root, best first. */
  candidates: RootCandidate[];
  /** Formats represented among the candidates, in the order they are preferred. */
  formats: SourceFormat[];
  /** The candidate the import will use unless overridden. */
  primary: RootCandidate | null;
  /**
   * Other roots of the *same* format as `primary` — a multi-root upload
   * (several `\documentclass` files, several stray Markdown files). These are
   * the files the caller can offer to attach as chapters or sections.
   */
  extraRoots: RootCandidate[];
}

export interface AnalyzeOptions {
  /** Restrict candidates to one format (the host's format dropdown). */
  sourceFormat?: SourceFormat;
  /** Force a specific file as the root, whatever the heuristics prefer. */
  mainFile?: string;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const PRETEXT_EXTENSIONS = new Set(["ptx", "xml"]);
/** Filenames that are documentation *about* a project, not the project. */
const NON_DOCUMENT_STEMS = new Set([
  "readme",
  "changelog",
  "contributing",
  "license",
]);

/** Names authors give the file that drives a whole document. */
const DRIVER_STEMS = [
  "main",
  "book",
  "index",
  "root",
  "master",
  "thesis",
  "dissertation",
  "article",
  "paper",
];

function filesWithExtensions(
  files: Record<string, string>,
  extensions: Set<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => extensions.has(extension(path))),
  );
}

/** Title of a PreTeXt document: the `<title>` of its root division. */
function pretextTitle(contents: string): string | undefined {
  const root =
    findFirstElement(contents, "pretext") ??
    findFirstElement(contents, "book") ??
    findFirstElement(contents, "article");
  const scope = root ? root.inner : contents;
  const title = findFirstElement(scope, "title");
  const text = title?.inner
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** Title of a Markdown document: its first ATX heading. */
function markdownTitle(contents: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(contents);
  return match ? match[1].trim() : undefined;
}

function latexTitle(contents: string): string | undefined {
  return extractLatexField(contents, "title") || undefined;
}

/** Does this LaTeX file stand on its own, rather than being a chapter part? */
function isLatexRoot(contents: string): boolean {
  return (
    /\\documentclass\b/.test(contents) || /\\begin *\{document\}/.test(contents)
  );
}

const PTX_ROOT_RE = /<(pretext|book|article)\b/;

/**
 * Collect the roots declared by a `project.ptx`: one candidate per distinct
 * target source that actually exists in the upload, in manifest order with the
 * default target first.
 */
function manifestCandidates(
  manifest: ProjectManifest,
  files: Record<string, string>,
): RootCandidate[] {
  const preferred = defaultManifestTarget(manifest);
  const ordered = preferred
    ? [preferred, ...manifest.targets.filter((t) => t !== preferred)]
    : manifest.targets;

  const seen = new Set<string>();
  const candidates: RootCandidate[] = [];
  for (const target of ordered) {
    const path = joinPath(manifest.projectRoot, target.source);
    if (seen.has(path) || !(path in files)) {
      continue;
    }
    seen.add(path);
    candidates.push({
      path,
      format: "pretext",
      reason: "manifest-target",
      title: pretextTitle(files[path]),
      targetName: target.name,
      targetFormat: target.format,
    });
  }
  return candidates;
}

function latexCandidates(files: Record<string, string>): RootCandidate[] {
  const texFiles = filesWithExtensions(files, new Set(["tex", "ltx"]));
  const included = collectTexInputTargets(texFiles);
  const roots = Object.keys(texFiles)
    .filter((path) => !included.has(path) && isLatexRoot(texFiles[path]))
    .sort();

  // Rank roots the way a reader would: a real `\documentclass` beats a bare
  // `\begin{document}`; a conventional driver name beats an incidental one;
  // and a file that pulls in others is more likely the book than one that
  // stands alone. Only then does alphabetical order break the tie.
  const inputCount = (path: string): number => {
    let count = 0;
    const matches =
      texFiles[path].match(/\\(input|include) *\{[^{}]+\}/g) ?? [];
    for (const raw of matches) {
      const requested = /\{([^{}]+)\}/.exec(raw)?.[1];
      if (requested && resolveInputTarget(requested, path, texFiles)) {
        count += 1;
      }
    }
    return count;
  };
  const nameRank = (path: string): number => {
    const index = DRIVER_STEMS.indexOf(stem(path).toLowerCase());
    return index >= 0 ? index : DRIVER_STEMS.length;
  };
  const ranked = [...roots].sort((a, b) => {
    const classRank =
      Number(!/\\documentclass\b/.test(texFiles[a])) -
      Number(!/\\documentclass\b/.test(texFiles[b]));
    if (classRank !== 0) return classRank;
    const byName = nameRank(a) - nameRank(b);
    if (byName !== 0) return byName;
    const byInputs = inputCount(b) - inputCount(a);
    if (byInputs !== 0) return byInputs;
    return a.localeCompare(b);
  });

  const candidates = ranked.map((path) => ({
    path,
    format: "latex" as const,
    reason: "latex-root" as const,
    title: latexTitle(texFiles[path]),
  }));

  if (candidates.length > 0) {
    return candidates;
  }
  // Nothing declares a document; fall back to any .tex, so a bare fragment
  // upload still imports.
  return Object.keys(texFiles)
    .sort()
    .map((path) => ({
      path,
      format: "latex" as const,
      reason: "fallback" as const,
      title: latexTitle(texFiles[path]),
    }));
}

function markdownCandidates(files: Record<string, string>): RootCandidate[] {
  const mdFiles = filesWithExtensions(files, MARKDOWN_EXTENSIONS);
  const paths = Object.keys(mdFiles).sort();
  // A README describes the repository, not the book — never let it be the
  // preferred root while any other Markdown file exists.
  const isAside = (path: string) =>
    NON_DOCUMENT_STEMS.has(stem(path).toLowerCase());
  const preferredNames = ["main", "index", "book", "article"];
  const rank = (path: string) => {
    if (isAside(path)) return 2;
    const index = preferredNames.indexOf(stem(path).toLowerCase());
    return index >= 0 ? 0 : 1;
  };
  return [...paths]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((path) => ({
      path,
      format: "markdown" as const,
      reason: "markdown-root" as const,
      title: markdownTitle(mdFiles[path]),
    }));
}

function pretextCandidates(files: Record<string, string>): RootCandidate[] {
  const ptxFiles = filesWithExtensions(files, PRETEXT_EXTENSIONS);
  const included = collectPretextIncludeTargets(ptxFiles);
  const roots = Object.keys(ptxFiles)
    .filter(
      (path) =>
        !included.has(path) &&
        PTX_ROOT_RE.test(ptxFiles[path]) &&
        basename(path).toLowerCase() !== "project.ptx" &&
        basename(path).toLowerCase() !== "publication.ptx",
    )
    .sort();

  return roots.map((path) => ({
    path,
    format: "pretext" as const,
    reason: "pretext-root" as const,
    title: pretextTitle(ptxFiles[path]),
  }));
}

/**
 * Survey an uploaded file set for possible document roots.
 *
 * Preference order, highest first: a `project.ptx` target (an existing PreTeXt
 * project always knows its own root), then LaTeX, Markdown, and finally loose
 * PreTeXt files — matching the pre-manifest behaviour of the pipeline.
 */
export function analyzeImportSources(
  files: Record<string, string>,
  options: AnalyzeOptions = {},
): UploadAnalysis {
  const manifest = findProjectManifest(files);

  const byFormat: RootCandidate[] = [
    ...(manifest ? manifestCandidates(manifest, files) : []),
    ...latexCandidates(files),
    ...markdownCandidates(files),
    ...pretextCandidates(files),
  ];

  // A manifest target and a loose PreTeXt scan can name the same file; the
  // manifest's richer record wins.
  const deduped: RootCandidate[] = [];
  const seenPaths = new Set<string>();
  for (const candidate of byFormat) {
    if (seenPaths.has(candidate.path)) {
      continue;
    }
    seenPaths.add(candidate.path);
    deduped.push(candidate);
  }

  const candidates = options.sourceFormat
    ? deduped.filter((c) => c.format === options.sourceFormat)
    : deduped;

  const formats: SourceFormat[] = [];
  for (const candidate of deduped) {
    if (!formats.includes(candidate.format)) {
      formats.push(candidate.format);
    }
  }

  let primary: RootCandidate | null = candidates[0] ?? null;
  if (options.mainFile) {
    const forcedPath = options.mainFile;
    primary =
      candidates.find((c) => c.path === forcedPath) ??
      deduped.find((c) => c.path === forcedPath) ??
      (forcedPath in files
        ? {
            path: forcedPath,
            format:
              options.sourceFormat ?? detectSourceFormat(files[forcedPath]),
            reason: "fallback",
          }
        : primary);
  }

  if (!primary) {
    // No recognised root at all: take the first file and sniff it, so an
    // upload of one oddly-named text file still imports.
    const fallbackPath = Object.keys(files).sort()[0];
    primary = fallbackPath
      ? {
          path: fallbackPath,
          format:
            options.sourceFormat ?? detectSourceFormat(files[fallbackPath]),
          reason: "fallback",
        }
      : null;
  }

  // Only LaTeX/Markdown roots are attachable: a second `project.ptx` target is
  // an alternative build of the same book, not extra content to append.
  const chosen = primary;
  const extraRoots =
    chosen && (chosen.format === "latex" || chosen.format === "markdown")
      ? candidates.filter(
          (c) =>
            c.path !== chosen.path &&
            c.format === chosen.format &&
            c.reason !== "manifest-target",
        )
      : [];

  return { manifest, candidates, formats, primary, extraRoots };
}
