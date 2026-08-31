import * as path from "path";
import * as vscode from "vscode";
import {
  PANDOC_ACCEPT_EXTENSIONS,
  fileExtension,
  importProjectFromFiles,
  type ImportedProjectSuccess,
} from "@pretextbook/import";
import { lspProjectXmlIds } from "./lsp-client/main";
import { pandocInstalled, pandocToPretextWithMedia } from "./pandoc";
import { isSafeRelativePath } from "./pure-utils";
import { pretextOutputChannel } from "./ui";
import {
  hrefBaseFor,
  includeBlock,
  readExternalDirectory,
  offeredTargetTags,
  resolveAttachmentPoint,
  xiNamespaceInsertion,
  type AttachmentPoint,
} from "./insert-import-core";

// "Insert a file as a division" — the other half of import (see
// packages/import/SPEC.md §9). Where `cmdImportProject` scaffolds a whole new
// project, this brings one outside file into the document already open, as a
// division of it: new files beside the current one, one <xi:include> at the
// cursor, all in a single undoable edit.

/** Formats the import package converts itself, with no external tool. */
const NATIVE_EXTENSIONS = [".tex", ".md", ".markdown", ".ptx", ".xml"];

/** File-picker filters, widened to whatever pandoc can read when it is present. */
function openFilters(): Record<string, string[]> {
  const pandocExtensions = pandocInstalled() ? PANDOC_ACCEPT_EXTENSIONS : [];
  const all = [...new Set([...NATIVE_EXTENSIONS, ...pandocExtensions])].map(
    (ext) => ext.replace(/^\./, ""),
  );
  return {
    "Documents to import": all,
    "All files": ["*"],
  };
}

interface SourceText {
  text: string;
  /** Media pandoc extracted from a binary format, keyed by file name. */
  media?: Record<string, Uint8Array>;
  /**
   * The name the import pipeline sees. Anything pandoc converted arrives as
   * PreTeXt, so it must be named as PreTeXt — handing the pipeline `essay.docx`
   * would have it guess the format from an extension the content no longer has.
   */
  virtualName: string;
}

/** Read the chosen file, routing anything the package cannot read through pandoc. */
async function readSourceFile(uri: vscode.Uri): Promise<SourceText> {
  const name = path.basename(uri.fsPath);
  if (NATIVE_EXTENSIONS.includes(fileExtension(name))) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { text: new TextDecoder().decode(bytes), virtualName: name };
  }
  if (!pandocInstalled()) {
    throw new Error(
      `Reading ${fileExtension(name) || "this kind of"} files needs pandoc, which was not found on your PATH.`,
    );
  }
  // A Word document carries its figures inside it; pandoc will hand them over,
  // but only if asked, and only the local binary can do it (the remote endpoint
  // answers text/plain — see packages/import/SPEC.md §9.7).
  const converted = await pandocToPretextWithMedia(uri.fsPath);
  return {
    text: converted.pretext,
    media: converted.media,
    virtualName: `${name.replace(/\.[^.]*$/, "")}.ptx`,
  };
}

/**
 * The active editor's file as a workspace-relative path, or `undefined` when
 * it lives outside the workspace — in which case there is nowhere to write the
 * new files that both the editor and the project would agree on.
 */
function workspaceRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return undefined;
  }
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
}

/**
 * Everything about *where* an insert is going, read from the active editor at
 * the moment the author asks for one.
 *
 * Captured up front and held for the life of the operation: the wizard can stay
 * open while the author looks at other files, and an import confirmed then must
 * still land where they said, not wherever the cursor has since wandered.
 */
export interface InsertContext {
  document: vscode.TextDocument;
  attachment: AttachmentPoint;
  /** The receiving file's path within the workspace. */
  relativePath: string;
}

/** Read the insert context, explaining to the author when there isn't one. */
export function insertContextForActiveEditor(): InsertContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "pretext") {
    vscode.window.showErrorMessage(
      "Open the PreTeXt file you want to insert into, and put the cursor where the new material goes.",
    );
    return undefined;
  }

  const document = editor.document;
  const relativePath = workspaceRelativePath(document.uri);
  if (relativePath === undefined) {
    vscode.window.showErrorMessage(
      "This file is not inside the open workspace, so there is nowhere to write the imported files.",
    );
    return undefined;
  }

  const cursor = editor.selection.active;
  const attachment = resolveAttachmentPoint(
    document.getText(),
    cursor.line,
    cursor.character,
    document.offsetAt(cursor),
  );
  if (!attachment) {
    vscode.window.showErrorMessage(
      "Put the cursor inside a division (a chapter, section, …) — that is what the imported file becomes part of.",
    );
    return undefined;
  }

  return { document, attachment, relativePath };
}

/**
 * What the wizard needs to render its attach-level control. Declared here
 * rather than imported from `@pretextbook/import/react`, whose subpath the
 * extension host's module resolution cannot see — and which would be the wrong
 * dependency anyway, since this crosses `postMessage` as JSON. Structurally
 * identical to `InsertTargetOffer` there.
 */
export interface InsertTargetOffer {
  documentLabel: string;
  defaultTargetTag: string;
  targetTags: string[];
  takenIds: string[];
  hrefBase: string;
  /** The host project's `<directories external="…"/>`, for imported images. */
  externalDir?: string;
}

/**
 * Where the host project keeps author-supplied images, from its publication
 * file's `<directories external="…"/>`.
 *
 * Looked for at the conventional location (`publication/`) rather than by
 * following the manifest's `publication` attribute through its own resolution
 * rules. Getting it wrong costs a directory name, and the fallback — the
 * `external` this package's own publication file declares — is what a project
 * created by this extension or by `pretext new` uses anyway.
 */
export async function hostExternalDir(
  documentUri: vscode.Uri,
): Promise<string | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!folder) {
    return undefined;
  }
  const publicationDir = vscode.Uri.joinPath(folder.uri, "publication");
  try {
    const entries = await vscode.workspace.fs.readDirectory(publicationDir);
    const names = entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter((name) => name.endsWith(".ptx"));
    const name =
      names.find((n) => n === "publication.ptx") ?? names[0] ?? undefined;
    if (!name) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(publicationDir, name),
    );
    return readExternalDirectory(new TextDecoder().decode(bytes));
  } catch {
    return undefined; // no publication directory, or unreadable
  }
}

/** The offer the wizard renders its attach-level control from. */
export async function insertOfferForContext(
  context: InsertContext,
): Promise<InsertTargetOffer> {
  return {
    documentLabel: path.basename(context.document.fileName),
    defaultTargetTag: context.attachment.targetTag,
    targetTags: offeredTargetTags(context.attachment.targetTag),
    takenIds: await lspProjectXmlIds(),
    hrefBase: hrefBaseFor(context.relativePath),
    externalDir: await hostExternalDir(context.document.uri),
  };
}

export async function cmdInsertFileAsDivision(): Promise<void> {
  const context = insertContextForActiveEditor();
  if (!context) {
    return;
  }
  const { document, attachment, relativePath } = context;

  const picked = await vscode.window.showOpenDialog({
    title: `Insert a file as a <${attachment.targetTag}>`,
    openLabel: "Insert",
    canSelectMany: false,
    filters: openFilters(),
  });
  if (!picked || !picked[0]) {
    return;
  }
  const sourceUri = picked[0];
  const sourceName = path.basename(sourceUri.fsPath);

  try {
    const { text, virtualName, media } = await readSourceFile(sourceUri);
    const takenIds = new Set(await lspProjectXmlIds());

    const result = importProjectFromFiles(
      { [virtualName]: text },
      {
        assets: media,
        externalDir: await hostExternalDir(document.uri),
        destination: {
          kind: "insert",
          targetTag: attachment.targetTag,
          takenIds,
          hrefBase: hrefBaseFor(relativePath),
        },
      },
    );
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }

    const payload = payloadFor(sourceName, result);
    const applied = await applyInsertToDocument(document, payload, attachment);
    if (!applied) {
      vscode.window.showErrorMessage(
        `Could not insert ${sourceName}; nothing was written.`,
      );
      return;
    }
    reportInsert(payload, attachment, applied);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pretextOutputChannel.appendLine(`Insert import failed: ${detail}`);
    vscode.window.showErrorMessage(`Could not insert ${sourceName}: ${detail}`);
  }
}

/**
 * Everything an insert needs written, independent of where it came from — the
 * one-file command below, or the wizard panel posting a confirmed import back
 * from the webview.
 */
export interface InsertPayload {
  sourceName: string;
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
  includes: string[];
  renamed: Array<{ from: string; to: string }>;
  /** Preformatted warning lines for the output channel. */
  warnings: string[];
}

/** The payload for an import run in this process. */
function payloadFor(
  sourceName: string,
  result: ImportedProjectSuccess,
): InsertPayload {
  return {
    sourceName,
    files: result.outputFiles,
    assets: result.outputAssets,
    includes: result.insert?.includes ?? [],
    renamed: result.insert?.renamed ?? [],
    warnings: result.warnings
      .map((warning) => warning.message)
      .filter((message): message is string => message !== undefined),
  };
}

/**
 * Write the new files and splice in the include as one `WorkspaceEdit`.
 *
 * One edit rather than several, because a half-applied import is worse than no
 * import: an `<xi:include>` pointing at a file that was never written breaks
 * the build, and files with nothing including them are litter. As one edit it
 * is also one Ctrl+Z.
 */
export async function applyInsertToDocument(
  document: vscode.TextDocument,
  payload: InsertPayload,
  attachment: AttachmentPoint,
): Promise<string[] | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return undefined;
  }

  const safeFiles = Object.entries(payload.files).filter(([relPath]) => {
    if (isSafeRelativePath(relPath)) {
      return true;
    }
    pretextOutputChannel.appendLine(
      `  Skipped unsafe path from import: ${relPath}`,
    );
    return false;
  });

  // Importing the same file twice would otherwise fail deep inside applyEdit,
  // with nothing said about which file was in the way.
  const overwrite = await confirmOverwrites(folder.uri, safeFiles);
  if (overwrite === undefined) {
    return undefined;
  }

  const written: string[] = [];
  const edit = new vscode.WorkspaceEdit();

  for (const [relPath, content] of safeFiles) {
    const uri = vscode.Uri.joinPath(folder.uri, ...relPath.split("/"));
    edit.createFile(uri, { overwrite, ignoreIfExists: false });
    edit.insert(uri, new vscode.Position(0, 0), content);
    written.push(relPath);
  }

  for (const [relPath, bytes] of Object.entries(payload.assets)) {
    if (!isSafeRelativePath(relPath)) {
      continue;
    }
    // Binary assets cannot ride in a WorkspaceEdit, which carries text edits
    // only. They are written directly; an asset without its division is
    // harmless, which is why they can sit outside the atomic edit.
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folder.uri, ...relPath.split("/")),
      bytes,
    );
    written.push(relPath);
  }

  const block = includeBlock(attachment, payload.includes);
  edit.insert(
    document.uri,
    document.validatePosition(new vscode.Position(attachment.line, 0)),
    block,
  );

  // A file receiving its first include has to declare the namespace itself.
  const namespace = xiNamespaceInsertion(document.getText());
  if (namespace) {
    edit.insert(
      document.uri,
      document.positionAt(namespace.offset),
      namespace.attribute,
    );
  }

  const ok = await vscode.workspace.applyEdit(edit);
  return ok ? written : undefined;
}

/**
 * Ask before replacing files an earlier import left behind. Returns the
 * `overwrite` flag for the edit, or `undefined` when the author backed out.
 */
async function confirmOverwrites(
  base: vscode.Uri,
  files: Array<[string, string]>,
): Promise<boolean | undefined> {
  const existing: string[] = [];
  for (const [relPath] of files) {
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(base, ...relPath.split("/")),
      );
      existing.push(relPath);
    } catch {
      // Does not exist, which is the normal case.
    }
  }
  if (existing.length === 0) {
    return false;
  }

  const choice = await vscode.window.showWarningMessage(
    `${existing.length} file${existing.length === 1 ? "" : "s"} would be replaced by this import.`,
    { modal: true, detail: existing.join("\n") },
    "Replace",
  );
  return choice === "Replace" ? true : undefined;
}

export function reportInsert(
  payload: InsertPayload,
  attachment: AttachmentPoint,
  written: string[],
): void {
  const { sourceName } = payload;
  pretextOutputChannel.appendLine(
    `Inserted ${sourceName} as a <${attachment.targetTag}> of the enclosing <${attachment.containerTag}> — wrote ${written.length} file(s).`,
  );
  if (attachment.note) {
    pretextOutputChannel.appendLine(`  ${attachment.note}`);
  }
  for (const rename of payload.renamed) {
    pretextOutputChannel.appendLine(
      `  Renamed xml:id \`${rename.from}\` to \`${rename.to}\` (already used in this project).`,
    );
  }
  for (const warning of payload.warnings) {
    pretextOutputChannel.appendLine(`  ${warning}`);
  }

  const renamedCount = payload.renamed.length;
  const detail = [
    `${written.length} file${written.length === 1 ? "" : "s"} written`,
    renamedCount > 0
      ? `${renamedCount} id${renamedCount === 1 ? "" : "s"} renamed`
      : undefined,
    attachment.note ? "placement adjusted" : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  void vscode.window
    .showInformationMessage(
      `Inserted ${sourceName} as a <${attachment.targetTag}> (${detail}).`,
      "Show Log",
    )
    .then((action) => {
      if (action === "Show Log") {
        pretextOutputChannel.show();
      }
    });
}
