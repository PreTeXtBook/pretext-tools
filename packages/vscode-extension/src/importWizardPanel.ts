import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { importProjectFromFiles } from "@pretextbook/import";
import { getNonce } from "./utils";
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

export function cmdImportProject(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "pretext.importWizard",
    "Import to PreTeXt",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );
  panel.webview.html = getHtmlForWebview(
    panel.webview,
    context.extensionUri,
    pandocInstalled(),
  );

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
          const written = await writeImportedProject(
            message as ImportConfirmMessage,
          );
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

/** Reject absolute paths and any path containing a ".." segment. Native mode
 * can carry raw archive paths, so guard against zip-slip style entries. */
function isSafeRelativePath(relPath: string): boolean {
  if (/^([a-zA-Z]:)?[\\/]/.test(relPath)) {
    return false;
  }
  return !relPath
    .split(/[\\/]/)
    .some((segment) => segment === ".." || segment === "");
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

function getHtmlForWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pandocAvailable: boolean,
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
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
              --color-slate-400: #64748b;
              /* text: lighter as the number grows, matching the light scale */
              --color-slate-500: #94a3b8;
              --color-slate-600: #cbd5e1;
              --color-slate-700: #e2e8f0;
              --color-slate-800: #eef2f7;
              --color-slate-900: #f8fafc;
              /* primary accent → follow the theme's button color */
              --color-blue-50: #17314e;
              --color-blue-500: #3b82f6;
              --color-blue-600: var(--vscode-button-hoverBackground, #2563eb);
              --color-blue-700: var(--vscode-button-background, #2f6fed);
              /* status: dark fills, light text */
              --color-amber-50: #3a2f14;
              --color-amber-100: #4a3c17;
              --color-amber-200: #6b5320;
              --color-amber-700: #fcd34d;
              --color-amber-800: #fde68a;
              --color-red-50: #3a1d1d;
              --color-red-200: #6b2b2b;
              --color-red-800: #fca5a5;
              --color-green-700: #86efac;
            }

            /* --color-white does double duty (button label + preview code
               background); keep it light for the label, darken only the code. */
            body.vscode-dark .bg-white,
            body.vscode-high-contrast:not(.vscode-high-contrast-light) .bg-white {
              background-color: var(--vscode-textCodeBlock-background, #0f141b);
            }
          </style>
          <script nonce="${nonce}">
            window.__ptxImport = { pandocAvailable: ${pandocAvailable ? "true" : "false"} };
          </script>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`;
}
