// Projects the division pool (SPEC §4.1) onto a VS Code-style project file
// tree (SPEC §4.2): one file per division, `<plus:TYPE ref="…"/>`
// placeholders rewritten to `<xi:include>`, docinfo re-inlined into the main
// file, plus the project.ptx / publication.ptx scaffold.

import { ensureXIncludeNamespace, slugify, withProlog } from "../layout/shared";
import { renderProjectPtx, renderPublicationPtx } from "../layout/templates";
import {
  filePrefixForDivision,
  isSingletonDivision,
} from "../pretext-divisions";
import type { ImportedDivision, ImportedProject } from "../types";

export interface SerializeProjectFilesOptions {
  mainSourcePath?: string;
  publicationPath?: string;
  projectFilePath?: string;
  /** When false, only source files are emitted (no project/publication). */
  includeScaffold?: boolean;
}

export interface SerializedProjectFiles {
  files: Record<string, string>;
  /**
   * Which file each division landed in, keyed by its `xml:id`. Hosts need this
   * to attach anything division-shaped — a cleaning diff, a warning count — to
   * the file the author is actually looking at.
   */
  pathByRef: Record<string, string>;
}

const DEFAULTS = {
  mainSourcePath: "source/main.ptx",
  publicationPath: "publication/publication.ptx",
  projectFilePath: "project.ptx",
};

/** Matches the canonical internal division placeholder (self-closing form). */
const DIVISION_PLACEHOLDER_RE =
  /<plus:([a-zA-Z][a-zA-Z-]*)\s+ref="([^"]+)"\s*\/>/g;

/** The refs of a division's direct children, in document order. */
export function divisionChildRefs(content: string): string[] {
  const refs: string[] = [];
  DIVISION_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIVISION_PLACEHOLDER_RE.exec(content)) !== null) {
    refs.push(m[2]);
  }
  return refs;
}

/** Type-prefixed slug of a division's xmlId, for its filename (`ch-intro`). */
function prefixedSlug(xmlId: string, prefix: string): string {
  const cleaned = slugify(xmlId) || "division";
  return cleaned.startsWith(`${prefix}-`) ? cleaned : `${prefix}-${cleaned}`;
}

/** Deduplicate a name against those already taken (`-2`, `-3`, … suffixes). */
function claimName(taken: Set<string>, preferred: string): string {
  let candidate = preferred;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${preferred}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * A section generated inside chapter `ch-01` gets an xmlId like
 * `ch-01-sec-02`; its file lives in that chapter's directory already, so the
 * chapter prefix would be redundant in the filename.
 */
function childFileBasis(childXmlId: string, parentXmlId: string): string {
  const prefix = `${parentXmlId}-`;
  return childXmlId.startsWith(prefix)
    ? childXmlId.slice(prefix.length)
    : childXmlId;
}

function replacePlaceholders(
  content: string,
  hrefByRef: Map<string, string>,
): string {
  return content.replace(
    DIVISION_PLACEHOLDER_RE,
    (whole, _tag, ref: string) => {
      const href = hrefByRef.get(ref);
      return href ? `<xi:include href="${href}"/>` : whole;
    },
  );
}

/**
 * Serialize the division pool to a project file tree. Binary assets are not
 * included — they are carried separately on `ImportedProject.assets` and
 * routed by the caller (paths differ per host).
 */
export function serializeProjectToFiles(
  project: ImportedProject,
  options: SerializeProjectFilesOptions = {},
): SerializedProjectFiles {
  const mainSourcePath = options.mainSourcePath ?? DEFAULTS.mainSourcePath;
  const publicationPath = options.publicationPath ?? DEFAULTS.publicationPath;
  const projectFilePath = options.projectFilePath ?? DEFAULTS.projectFilePath;
  const includeScaffold = options.includeScaffold ?? true;

  const files: Record<string, string> = {};
  const byRef = new Map<string, ImportedDivision>(
    project.divisions.map((d) => [d.xmlId, d]),
  );
  const root = project.divisions.find((d) => d.isRoot);
  if (!root) {
    throw new Error("Division pool has no root division.");
  }

  // href values are relative to the including file's own directory: a chapter
  // file at source/ch-intro.ptx includes its sections as ch-intro/sec-1.ptx.
  const hrefByRef = new Map<string, string>();
  const sourceDir = mainSourcePath.includes("/")
    ? mainSourcePath.slice(0, mainSourcePath.lastIndexOf("/") + 1)
    : "";

  // First pass: assign a file to every division, so hrefs can be resolved in
  // any order. Each division's children live in a directory named after it,
  // recursing for as many levels as the pool was split into.
  interface PlacedDivision {
    division: ImportedDivision;
    filePath: string;
  }
  const placed: PlacedDivision[] = [];
  const placedIds = new Set<string>();
  // Filenames only have to be unique within their own directory.
  const takenByDirectory = new Map<string, Set<string>>();

  function claimInDirectory(directory: string, preferred: string): string {
    let taken = takenByDirectory.get(directory);
    if (!taken) {
      taken = new Set<string>();
      takenByDirectory.set(directory, taken);
    }
    return claimName(taken, preferred);
  }

  function place(
    division: ImportedDivision,
    directory: string,
    hrefPrefix: string,
    parentXmlId: string,
  ): void {
    if (placedIds.has(division.xmlId)) {
      return;
    }
    placedIds.add(division.xmlId);

    const slug = claimInDirectory(
      directory,
      isSingletonDivision(division.type)
        ? division.type
        : prefixedSlug(
            childFileBasis(division.xmlId, parentXmlId),
            filePrefixForDivision(division.type),
          ),
    );
    hrefByRef.set(division.xmlId, `${hrefPrefix}${slug}.ptx`);
    placed.push({ division, filePath: `${directory}${slug}.ptx` });

    for (const childRef of divisionChildRefs(division.content)) {
      const child = byRef.get(childRef);
      if (child) {
        place(child, `${directory}${slug}/`, `${slug}/`, division.xmlId);
      }
    }
  }

  for (const childRef of divisionChildRefs(root.content)) {
    const child = byRef.get(childRef);
    if (child) {
      place(child, sourceDir, "", root.xmlId);
    }
  }

  // Orphans (divisions reachable from no placeholder — the multi-root case,
  // SPEC §3.3/§4.1) still get a file at source/ so nothing silently
  // disappears; they just aren't xi:included anywhere.
  const referenced = new Set<string>();
  for (const division of project.divisions) {
    for (const childRef of divisionChildRefs(division.content)) {
      referenced.add(childRef);
    }
  }
  for (const division of project.divisions) {
    if (division.isRoot || referenced.has(division.xmlId)) {
      continue;
    }
    place(division, sourceDir, "", root.xmlId);
  }

  // Second pass: write each division file with placeholders resolved.
  for (const { division, filePath } of placed) {
    const resolved = replacePlaceholders(division.content, hrefByRef);
    const content =
      resolved === division.content
        ? resolved
        : ensureXIncludeNamespace(resolved);
    files[filePath] = withProlog(content);
  }

  // Main file: <pretext> wrapper with docinfo re-inlined ahead of the root.
  // The xi namespace is only declared when the root actually gained
  // <xi:include> references.
  const rootResolved = replacePlaceholders(root.content, hrefByRef);
  const docinfoBlock = project.docinfo ? `${project.docinfo}\n` : "";
  const mainBody = `<pretext>\n${docinfoBlock}${rootResolved}\n</pretext>`;
  files[mainSourcePath] = withProlog(
    rootResolved === root.content
      ? mainBody
      : ensureXIncludeNamespace(mainBody),
  );

  if (includeScaffold) {
    files[projectFilePath] = renderProjectPtx({
      mainSource: mainSourcePath,
      publication: publicationPath,
    });
    files[publicationPath] = renderPublicationPtx();
  }

  const pathByRef: Record<string, string> = { [root.xmlId]: mainSourcePath };
  for (const { division, filePath } of placed) {
    pathByRef[division.xmlId] = filePath;
  }

  return { files, pathByRef };
}
