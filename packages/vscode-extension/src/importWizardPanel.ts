import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { importProjectFromFiles } from "@pretextbook/import";
import { getNonce } from "./utils";
import { isSafeRelativePath } from "./pure-utils";
import {
  applyInsertToDocument,
  insertContextForActiveEditor,
  insertOfferForContext,
  reportInsert,
  type InsertContext,
  type InsertTargetOffer,
} from "./insert-import";
import { pretextOutputChannel } from "./ui";
import { pandocInstalled, pandocToPretext } from "./pandoc";

// Hosts the shared ImportWizard React component (from @pretextbook/import)
// in a webview panel. The whole import pipeline runs inside the webview; the
// host only receives the resolved file map and writes it to disk. See
// packages/import/SPEC.md §6 for the design.

interface ImportConfirmMessage {
  type: "import-confirm";
  mode: "converted" | "native";
  files: Record<string, string>;
  assetsBase64: Record<string, string>;
  sourceName: string;
  documentKind: string;
  warnings: string[];
  /**
   * Present when the panel was opened against a document to insert into: what
   * the webview's attach-level control settled on, and the includes it built.
   * The document and the position stay on the host, captured when the panel
   * opened (see `InsertContext`).
   */
  insert?: {
    includes: string[];
    renamed: Array<{ from: string; to: string }>;
  };
}

// The pandoc engine runs in the extension host (pandoc is a native binary, so
// it cannot run in the webview). The webview posts the uploaded file's bytes
// here; the host converts with pandoc's pretext.lua writer, reuses the import
// package's layout to produce the same result shape, and posts it back.
interface PandocConvertMessage {
  type: "pandoc-convert";
  requestId: string;
  fileName: string;
  dataBase64: string;
  options: { documentKind?: "article" | "book"; splitSections?: boolean };
}

export function cmdImportProject(
  context: vscode.ExtensionContext,
  insertInto?: InsertContext,
) {
  const panel = vscode.window.createWebviewPanel(
    "pretext.importWizard",
    insertInto
      ? `Insert into ${path.basename(insertInto.document.fileName)}`
      : "Import to PreTeXt",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  // The offer needs the project's live xml:ids, which come from the language
  // server, so the HTML is set once that answer arrives. Until then the panel
  // is blank, which is a beat rather than a wait.
  void (
    insertInto ? insertOfferForContext(insertInto) : Promise.resolve(undefined)
  ).then((insertTarget) => {
    panel.webview.html = getHtmlForWebview(
      panel.webview,
      context.extensionUri,
      pandocInstalled(),
      defaultImportMode(),
      insertTarget,
    );
  });

  panel.webview.onDidReceiveMessage(
    async (message: { type?: string }) => {
      if (message?.type === "import-cancel") {
        panel.dispose();
        return;
      }
      if (message?.type === "pandoc-convert") {
        await handlePandocConvert(panel, message as PandocConvertMessage);
        return;
      }
      if (message?.type === "import-confirm") {
        try {
          const confirm = message as ImportConfirmMessage;
          const written = insertInto
            ? await insertConfirmedImport(insertInto, confirm)
            : await writeImportedProject(confirm);
          if (written) {
            panel.dispose();
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to write imported project: ${detail}`,
          );
        }
      }
    },
    undefined,
    context.subscriptions,
  );
}

/**
 * Convert a single uploaded file with pandoc (via the pretext.lua writer) and
 * reuse the import package's layout to produce the same result shape the native
 * engine yields, then post it back to the webview's pandoc engine.
 */
async function handlePandocConvert(
  panel: vscode.WebviewPanel,
  message: PandocConvertMessage,
): Promise<void> {
  const { requestId, fileName, dataBase64, options } = message;
  let tempFile: string | undefined;
  try {
    const bytes = Buffer.from(dataBase64, "base64");
    // pandoc infers the input format from the file extension, so preserve it.
    const ext = path.extname(fileName);
    tempFile = path.join(os.tmpdir(), `ptx-import-${Date.now()}${ext}`);
    await fs.promises.writeFile(tempFile, bytes);

    const pretext = await pandocToPretext(tempFile);
    const result = importProjectFromFiles(
      { "source.ptx": pretext },
      {
        documentKind: options?.documentKind,
        splitSections: options?.splitSections,
      },
    );
    // Show the original file name in the review UI rather than "source.ptx".
    if (!("pretextError" in result)) {
      result.sourceName = fileName;
      result.sourcePath = fileName;
    }
    panel.webview.postMessage({ type: "pandoc-result", requestId, result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pretextOutputChannel.appendLine(`Pandoc import failed: ${detail}`);
    panel.webview.postMessage({
      type: "pandoc-result",
      requestId,
      error: detail,
    });
  } finally {
    if (tempFile) {
      void fs.promises.rm(tempFile, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Apply an import the webview confirmed into the document the panel was opened
 * against. The heavy lifting — the single `WorkspaceEdit`, the namespace, the
 * overwrite check — is the same code the one-file command uses.
 */
async function insertConfirmedImport(
  insertInto: InsertContext,
  message: ImportConfirmMessage,
): Promise<boolean> {
  const written = await applyInsertToDocument(
    insertInto.document,
    {
      sourceName: message.sourceName,
      files: message.files,
      assets: Object.fromEntries(
        Object.entries(message.assetsBase64).map(([relPath, base64]) => [
          relPath,
          new Uint8Array(Buffer.from(base64, "base64")),
        ]),
      ),
      includes: message.insert?.includes ?? [],
      renamed: message.insert?.renamed ?? [],
      warnings: message.warnings,
    },
    insertInto.attachment,
  );
  if (!written) {
    vscode.window.showErrorMessage(
      `Could not insert ${message.sourceName}; nothing was written.`,
    );
    return false;
  }
  reportInsert(
    {
      sourceName: message.sourceName,
      files: message.files,
      assets: {},
      includes: message.insert?.includes ?? [],
      renamed: message.insert?.renamed ?? [],
      warnings: message.warnings,
    },
    insertInto.attachment,
    written,
  );
  return true;
}

async function writeImportedProject(
  message: ImportConfirmMessage,
): Promise<boolean> {
  const picked = await vscode.window.showOpenDialog({
    title: "Select destination folder for the imported project",
    openLabel: "Import here",
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
  });
  if (!picked || !picked[0]) {
    return false; // user cancelled the dialog; keep the panel open
  }
  let destination = picked[0];

  let existingEntries: [string, vscode.FileType][] = [];
  try {
    existingEntries = await vscode.workspace.fs.readDirectory(destination);
  } catch {
    // Folder doesn't exist yet; createDirectory below handles it.
  }
  if (existingEntries.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `The folder "${destination.fsPath}" is not empty.`,
      { modal: true },
      "Create Subfolder",
      "Write Here Anyway",
    );
    if (!choice) {
      return false;
    }
    if (choice === "Create Subfolder") {
      const defaultName =
        message.sourceName
          .replace(/\.[^.]*$/, "")
          .replace(/[^\w-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "imported-project";
      const subfolder = await vscode.window.showInputBox({
        prompt: "Name for the new project folder",
        value: defaultName,
      });
      if (!subfolder) {
        return false;
      }
      destination = vscode.Uri.joinPath(destination, subfolder);
    }
  }

  const encoder = new TextEncoder();
  const entries: Array<[string, Uint8Array]> = [
    ...Object.entries(message.files).map(
      ([relPath, content]): [string, Uint8Array] => [
        relPath,
        encoder.encode(content),
      ],
    ),
    ...Object.entries(message.assetsBase64).map(
      ([relPath, base64]): [string, Uint8Array] => [
        relPath,
        new Uint8Array(Buffer.from(base64, "base64")),
      ],
    ),
  ];

  const skipped = entries
    .map(([relPath]) => relPath)
    .filter((relPath) => !isSafeRelativePath(relPath));
  const safeEntries = entries.filter(([relPath]) =>
    isSafeRelativePath(relPath),
  );

  await vscode.workspace.fs.createDirectory(destination);
  const directories = new Set<string>();
  for (const [relPath] of safeEntries) {
    const slash = relPath.lastIndexOf("/");
    if (slash > 0) {
      directories.add(relPath.slice(0, slash));
    }
  }
  for (const dir of directories) {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(destination, ...dir.split("/")),
    );
  }
  for (const [relPath, bytes] of safeEntries) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(destination, ...relPath.split("/")),
      bytes,
    );
  }

  pretextOutputChannel.appendLine(
    `Imported ${message.sourceName} (${message.documentKind}, ${message.mode}) — wrote ${safeEntries.length} files to ${destination.fsPath}.`,
  );
  for (const relPath of skipped) {
    pretextOutputChannel.appendLine(
      `  Skipped unsafe path from import: ${relPath}`,
    );
  }
  if (message.warnings.length > 0) {
    pretextOutputChannel.appendLine(
      `  ${message.warnings.length} conversion warning(s):`,
    );
    for (const warning of message.warnings) {
      pretextOutputChannel.appendLine(`    ${warning}`);
    }
  }

  const action = await vscode.window.showInformationMessage(
    `Imported ${message.sourceName}: ${safeEntries.length} files written to ${destination.fsPath}.`,
    "Open Folder",
    "Open in New Window",
  );
  if (action === "Open Folder") {
    await vscode.commands.executeCommand("vscode.openFolder", destination);
  } else if (action === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", destination, {
      forceNewWindow: true,
    });
  }
  return true;
}

/**
 * Which import style the wizard opens on, from settings. The user can still
 * switch on the review step; this only picks the starting point.
 */
function defaultImportMode(): "converted" | "native" {
  return vscode.workspace
    .getConfiguration("pretext-tools")
    .get<string>("import.defaultMode") === "native"
    ? "native"
    : "converted";
}

function getHtmlForWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pandocAvailable: boolean,
  importMode: "converted" | "native",
  insertTarget?: InsertTargetOffer,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "media", "importWizard.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "out",
      "media",
      "assets",
      "importWizard.css",
    ),
  );
  const nonce = getNonce();

  // The shared wizard ships a fixed Tailwind palette (light). Rather than fork
  // the component, we make the panel theme-aware from the host: base surfaces
  // follow VS Code's editor colors, and for dark themes we redefine the Tailwind
  // palette variables (utilities compile to var(--color-*), defined on :root, so
  // a body-scoped override wins) to a dark scale and point the primary button at
  // the theme's button color. Light / high-contrast-light fall through to the
  // wizard's default light palette.
  return `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <!--
            worker-src is required: the built-in converter runs the import
            pipeline in a Web Worker so the panel stays responsive during a
            multi-second conversion. Without it the directive falls back
            through child-src to default-src 'none' and the worker is blocked.
            blob: covers the case where Vite inlines a small worker chunk
            rather than emitting it as a separate file.
          -->
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} blob:; worker-src ${webview.cspSource} blob:; img-src ${webview.cspSource} data:;">
          <title>Import to PreTeXt</title>
          <link href="${styleUri}" rel="stylesheet" />
          <style>
            body {
              background: var(--vscode-editor-background, #f8fafc);
              color: var(--vscode-editor-foreground, #0f172a);
              font-family: var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
              padding: 1.5rem;
            }
            #root {
              max-width: 720px;
              margin: 0 auto;
            }

            /* Dark themes (and high-contrast dark): remap the wizard's Tailwind
               palette to a dark scale. Excludes high-contrast-light. */
            body.vscode-dark,
            body.vscode-high-contrast:not(.vscode-high-contrast-light) {
              color-scheme: dark;
              /* surfaces */
              --color-slate-50: #1b2532;
              --color-slate-100: #22303f;
              --color-slate-200: #334155;
              --color-slate-300: #3f4d62;
              --color-slate-400: #8296ad;
              /* text: lighter as the number grows, matching the light scale */
              --color-slate-500: #94a3b8;
              --color-slate-600: #cbd5e1;
              --color-slate-700: #e2e8f0;
              --color-slate-800: #eef2f7;
              --color-slate-900: #f8fafc;
              /* primary accent → follow the theme's button color */
              --color-blue-50: #17314e;
              --color-blue-200: #2f5480;
              --color-blue-500: #3b82f6;
              --color-blue-600: var(--vscode-button-hoverBackground, #2563eb);
              --color-blue-700: var(--vscode-button-background, #2f6fed);
              /* 800/900 sit as text on the blue-50 notice fill, so they invert
                 like the slate scale rather than following the button color. */
              --color-blue-800: #bfdbfe;
              --color-blue-900: #eff6ff;
              /* status: dark fills, light text */
              --color-amber-50: #3a2f14;
              --color-amber-100: #4a3c17;
              --color-amber-200: #6b5320;
              --color-amber-700: #fcd34d;
              --color-amber-800: #fde68a;
              --color-red-50: #3a1d1d;
              --color-red-200: #6b2b2b;
              --color-red-800: #fca5a5;
              --color-red-900: #fca5a5;
              --color-green-50: #16301f;
              --color-green-700: #86efac;
              --color-green-900: #86efac;
            }

            /* Native dropdowns: Tailwind's preflight strips their background,
               and Chromium paints the option popup from the control's own
               background — transparent leaves it unreadable on a dark theme.
               Point both at VS Code's dropdown colors so the control matches
               the editor in every theme. */
            select,
            select option {
              background-color: var(--vscode-dropdown-background, #ffffff);
              color: var(--vscode-dropdown-foreground, var(--vscode-editor-foreground, #0f172a));
            }

            /* --color-white does double duty (button label + preview code
               background); keep it light for the label, darken only the code. */
            body.vscode-dark .bg-white,
            body.vscode-high-contrast:not(.vscode-high-contrast-light) .bg-white {
              background-color: var(--vscode-textCodeBlock-background, #0f141b);
            }
          </style>
          <script nonce="${nonce}">
            window.__ptxImport = { pandocAvailable: ${pandocAvailable ? "true" : "false"}, defaultImportMode: "${importMode}", insertTarget: ${insertTarget ? JSON.stringify(insertTarget) : "undefined"} };
          </script>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`;
}

/**
 * A PreTeXt document open in the workspace is what makes "insert into this
 * document" meaningful; without one there is nothing to insert into, so the
 * question is not worth asking.
 */
function hasInsertTarget(): boolean {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "pretext") {
    return false;
  }
  return vscode.workspace.getWorkspaceFolder(document.uri) !== undefined;
}

/**
 * The entry point for "Import…": scaffold a new project, or bring the material
 * into the document already open (packages/import/SPEC.md §9.2). The choice is
 * only offered when both are possible; the same wizard serves either, differing
 * only in the destination it is given.
 */
export async function cmdImport(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (!hasInsertTarget()) {
    cmdImportProject(context);
    return;
  }

  const fileName = path.basename(
    vscode.window.activeTextEditor!.document.fileName,
  );
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: `$(insert) Insert into ${fileName}`,
        detail:
          "Add the material as a division of the document you are editing, included at the cursor.",
        mode: "insert" as const,
      },
      {
        label: "$(new-folder) Create a new project",
        detail:
          "Convert the file (or archive) into a PreTeXt project of its own, in a folder you choose.",
        mode: "project" as const,
      },
    ],
    {
      title: "Import to PreTeXt",
      placeHolder: "Where should the imported material go?",
    },
  );
  if (!choice) {
    return;
  }

  if (choice.mode === "project") {
    cmdImportProject(context);
    return;
  }

  // Read where it goes *before* the panel opens, while the cursor still means
  // what the author meant by it.
  const insertInto = insertContextForActiveEditor();
  if (insertInto) {
    cmdImportProject(context, insertInto);
  }
}
