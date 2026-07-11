// Projects the division pool (SPEC §4.1) onto a VS Code-style project file
// tree (SPEC §4.2): one file per division, `<plus:TYPE ref="…"/>`
// placeholders rewritten to `<xi:include>`, docinfo re-inlined into the main
// file, plus the project.ptx / publication.ptx scaffold.

import { ensureXIncludeNamespace, slugify, withProlog } from '../layout/shared';
import { renderProjectPtx, renderPublicationPtx } from '../layout/templates';
import type { ImportedDivision, ImportedProject } from '../types';

export interface SerializeProjectFilesOptions {
  mainSourcePath?: string;
  publicationPath?: string;
  projectFilePath?: string;
  /** When false, only source files are emitted (no project/publication). */
  includeScaffold?: boolean;
}

export interface SerializedProjectFiles {
  files: Record<string, string>;
}

const DEFAULTS = {
  mainSourcePath: 'source/main.ptx',
  publicationPath: 'publication/publication.ptx',
  projectFilePath: 'project.ptx',
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

/** `ch-` / `sec-` prefixed slug of a division's xmlId, for its filename. */
function prefixedSlug(xmlId: string, prefix: string): string {
  const cleaned = slugify(xmlId) || 'division';
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
function sectionFileBasis(sectionXmlId: string, chapterXmlId: string): string {
  const prefix = `${chapterXmlId}-`;
  return sectionXmlId.startsWith(prefix)
    ? sectionXmlId.slice(prefix.length)
    : sectionXmlId;
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
    throw new Error('Division pool has no root division.');
  }

  const takenNames = new Set<string>();
  // href values are relative to the main source's directory (source/), which
  // is also where xi:include resolution happens for nested section files.
  const hrefByRef = new Map<string, string>();
  const sourceDir = mainSourcePath.includes('/')
    ? mainSourcePath.slice(0, mainSourcePath.lastIndexOf('/') + 1)
    : '';

  // First pass: assign filenames (chapters at source/, their children in a
  // per-chapter directory), so hrefs can be resolved in any order.
  interface PlacedDivision {
    division: ImportedDivision;
    filePath: string;
  }
  const placed: PlacedDivision[] = [];

  for (const chapterRef of divisionChildRefs(root.content)) {
    const chapter = byRef.get(chapterRef);
    if (!chapter) continue;
    const chapterSlug = claimName(
      takenNames,
      prefixedSlug(chapter.xmlId, 'ch'),
    );
    hrefByRef.set(chapter.xmlId, `${chapterSlug}.ptx`);
    placed.push({
      division: chapter,
      filePath: `${sourceDir}${chapterSlug}.ptx`,
    });

    const sectionNames = new Set<string>();
    for (const sectionRef of divisionChildRefs(chapter.content)) {
      const section = byRef.get(sectionRef);
      if (!section) continue;
      const sectionSlug = claimName(
        sectionNames,
        prefixedSlug(sectionFileBasis(section.xmlId, chapter.xmlId), 'sec'),
      );
      hrefByRef.set(section.xmlId, `${chapterSlug}/${sectionSlug}.ptx`);
      placed.push({
        division: section,
        filePath: `${sourceDir}${chapterSlug}/${sectionSlug}.ptx`,
      });
    }
  }

  // Orphans (divisions reachable from no placeholder — the multi-root case,
  // SPEC §3.3/§4.1) still get a file at source/ so nothing silently
  // disappears; they just aren't xi:included anywhere.
  const placedIds = new Set(placed.map((p) => p.division.xmlId));
  for (const division of project.divisions) {
    if (division.isRoot || placedIds.has(division.xmlId)) continue;
    const prefix = division.type === 'section' ? 'sec' : 'ch';
    const slug = claimName(takenNames, prefixedSlug(division.xmlId, prefix));
    hrefByRef.set(division.xmlId, `${slug}.ptx`);
    placed.push({ division, filePath: `${sourceDir}${slug}.ptx` });
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
  const docinfoBlock = project.docinfo ? `${project.docinfo}\n` : '';
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

  return { files };
}
