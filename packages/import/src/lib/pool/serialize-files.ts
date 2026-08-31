// Projects the division pool (SPEC §4.1) onto a VS Code-style project file
// tree (SPEC §4.2): one file per division, `<plus:TYPE ref="…"/>`
// placeholders rewritten to `<xi:include>`, docinfo re-inlined into the main
// file, plus the project.ptx / publication.ptx scaffold.
//
// This is the `project` destination (SPEC §9.2); `serialize-insert.ts` is the
// other one. Both share the placement pass in `place-divisions.ts`.

import { ensureXIncludeNamespace, withProlog } from "../layout/shared";
import { renderProjectPtx, renderPublicationPtx } from "../layout/templates";
import type { ImportedProject } from "../types";
import { placeDivisions } from "./place-divisions";
import { divisionChildRefs, replacePlaceholders } from "./placeholders";

export { divisionChildRefs } from "./placeholders";

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
  const byRef = new Map(project.divisions.map((d) => [d.xmlId, d]));
  const root = project.divisions.find((d) => d.isRoot);
  if (!root) {
    throw new Error("Division pool has no root division.");
  }

  // href values are relative to the including file's own directory: a chapter
  // file at source/ch-intro.ptx includes its sections as ch-intro/sec-1.ptx.
  const sourceDir = mainSourcePath.includes("/")
    ? mainSourcePath.slice(0, mainSourcePath.lastIndexOf("/") + 1)
    : "";

  const { placed, hrefByRef } = placeDivisions(project, {
    entries: divisionChildRefs(root.content)
      .map((ref) => byRef.get(ref))
      .filter((d) => d !== undefined),
    directory: sourceDir,
    parentXmlId: root.xmlId,
  });

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
