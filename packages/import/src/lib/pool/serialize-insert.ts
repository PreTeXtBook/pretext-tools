// Projects the division pool onto an *existing* project (SPEC §9.2): new files
// beside the file receiving the include, plus the `<xi:include>` elements the
// host splices in at the cursor.
//
// The difference from `serialize-files.ts` is confined to the root. A new
// project's root becomes `main.ptx` inside a `<pretext>` wrapper, with docinfo
// and scaffold; an insert has no `<pretext>` to write, and its root either
// becomes the inserted division itself or is dropped in favour of its children
// (see `shouldUnwrapRoot` in `insert/prepare.ts`). Everything below the root —
// the file tree, the hrefs, the placeholder rewriting — is shared.

import { ensureXIncludeNamespace, withProlog } from "../layout/shared";
import { findFirstElement } from "../layout/xml-scan";
import type { PretextDivisionTag } from "../pretext-divisions";
import type { ImportedDivision, ImportedProject } from "../types";
import { placeDivisions } from "./place-divisions";
import { divisionChildRefs, replacePlaceholders } from "./placeholders";

export interface SerializeInsertOptions {
  /** Division level the imported document becomes. */
  targetTag: PretextDivisionTag;
  /**
   * Directory of the file receiving the include, with a trailing slash. New
   * files land here, so hrefs are bare filenames.
   */
  hrefBase: string;
  /** Drop the document wrapper and insert its children instead (§9.2). */
  unwrapRoot: boolean;
}

export interface SerializedInsert {
  /** New files to write, keyed by workspace-relative path. */
  files: Record<string, string>;
  /**
   * The `<xi:include>` elements to splice into the parent file, in order.
   * Usually one; a titleless document that is nothing but a pile of divisions
   * contributes one per division (SPEC §9, story 3).
   */
  includes: string[];
  pathByRef: Record<string, string>;
}

/** Rename an element's outer tag, leaving its attributes and content alone. */
function renameOuterElement(
  content: string,
  currentTag: string,
  newTag: string,
): string {
  const span = findFirstElement(content, currentTag);
  if (!span) return content;
  const openTag = content
    .slice(span.start, span.startTagEnd)
    .replace(/^<\s*[^\s>/]+/, `<${newTag}`);
  const closeTag = content
    .slice(span.contentEnd, span.end)
    .replace(/^<\/\s*[^\s>]+/, `</${newTag}`);
  return (
    content.slice(0, span.start) +
    openTag +
    content.slice(span.startTagEnd, span.contentEnd) +
    closeTag +
    content.slice(span.end)
  );
}

/**
 * Serialize the division pool as an insertion into an existing project.
 *
 * `project.docinfo` is not written: a fragment joining a document inherits the
 * document's docinfo, and a second one would be invalid. Callers that care
 * report it; the pool keeps it either way.
 */
/**
 * The divisions the host actually receives, in order.
 *
 * When the wrapper survives it is retyped to the attach level first: it is
 * becoming a `<subsection>`, and both the filename and the record's own tag
 * come from its type, so `article-homework-3.ptx` is not what an author asked
 * for. When the wrapper is dropped, its children are the entries.
 */
export function insertEntries(
  project: ImportedProject,
  options: Pick<SerializeInsertOptions, "targetTag" | "unwrapRoot">,
): { root: ImportedDivision; entries: ImportedDivision[] } {
  const byRef = new Map(project.divisions.map((d) => [d.xmlId, d]));
  const root = project.divisions.find((d) => d.isRoot);
  if (!root) {
    throw new Error("Division pool has no root division.");
  }

  const entries = options.unwrapRoot
    ? divisionChildRefs(root.content)
        .map((ref) => byRef.get(ref))
        .filter((d) => d !== undefined)
    : [
        {
          ...root,
          type: options.targetTag,
          content: renameOuterElement(
            root.content,
            root.type,
            options.targetTag,
          ),
        },
      ];
  return { root, entries };
}

export function serializeInsertFiles(
  project: ImportedProject,
  options: SerializeInsertOptions,
): SerializedInsert {
  const { root, entries } = insertEntries(project, options);

  const { placed, hrefByRef } = placeDivisions(project, {
    entries,
    directory: options.hrefBase,
    parentXmlId: root.xmlId,
  });

  const files: Record<string, string> = {};
  const pathByRef: Record<string, string> = {};
  for (const { division, filePath } of placed) {
    const resolved = replacePlaceholders(division.content, hrefByRef);
    const content =
      resolved === division.content
        ? resolved
        : ensureXIncludeNamespace(resolved);
    files[filePath] = withProlog(content);
    pathByRef[division.xmlId] = filePath;
  }

  const includes = entries
    .map((entry) => hrefByRef.get(entry.xmlId))
    .filter((href) => href !== undefined)
    .map((href) => `<xi:include href="${href}"/>`);

  return { files, includes, pathByRef };
}
