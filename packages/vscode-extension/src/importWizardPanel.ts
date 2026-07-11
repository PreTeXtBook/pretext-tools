import * as vscode from 'vscode';
import { getNonce } from './utils';
import { pretextOutputChannel } from './ui';

// Hosts the shared ImportWizard React component (from @pretextbook/import)
// in a webview panel. The whole import pipeline runs inside the webview; the
// host only receives the resolved file map and writes it to disk. See
// packages/import/SPEC.md §6 for the design.

interface ImportConfirmMessage {
  type: 'import-confirm';
  mode: 'converted' | 'native';
  files: Record<string, string>;
  assetsBase64: Record<string, string>;
  sourceName: string;
  documentKind: string;
  warnings: string[];
}

export function cmdImportProject(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'pretext.importWizard',
    'Import to PreTeXt',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );
  panel.webview.html = getHtmlForWebview(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(
    async (message: { type?: string }) => {
      if (message?.type === 'import-cancel') {
        panel.dispose();
        return;
      }
      if (message?.type === 'import-confirm') {
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

/** Reject absolute paths and any path containing a ".." segment. Native mode
 * can carry raw archive paths, so guard against zip-slip style entries. */
function isSafeRelativePath(relPath: string): boolean {
  if (/^([a-zA-Z]:)?[\\/]/.test(relPath)) {
    return false;
  }
  return !relPath
    .split(/[\\/]/)
    .some((segment) => segment === '..' || segment === '');
}

async function writeImportedProject(
  message: ImportConfirmMessage,
): Promise<boolean> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select destination folder for the imported project',
    openLabel: 'Import here',
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
      'Create Subfolder',
      'Write Here Anyway',
    );
    if (!choice) {
      return false;
    }
    if (choice === 'Create Subfolder') {
      const defaultName =
        message.sourceName
          .replace(/\.[^.]*$/, '')
          .replace(/[^\w-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'imported-project';
      const subfolder = await vscode.window.showInputBox({
        prompt: 'Name for the new project folder',
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
        new Uint8Array(Buffer.from(base64, 'base64')),
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
    const slash = relPath.lastIndexOf('/');
    if (slash > 0) {
      directories.add(relPath.slice(0, slash));
    }
  }
  for (const dir of directories) {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(destination, ...dir.split('/')),
    );
  }
  for (const [relPath, bytes] of safeEntries) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(destination, ...relPath.split('/')),
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
    'Open Folder',
    'Open in New Window',
  );
  if (action === 'Open Folder') {
    await vscode.commands.executeCommand('vscode.openFolder', destination);
  } else if (action === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', destination, {
      forceNewWindow: true,
    });
  }
  return true;
}

function getHtmlForWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'media', 'importWizard.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      'out',
      'media',
      'assets',
      'importWizard.css',
    ),
  );
  const nonce = getNonce();

  // The wizard's styling is light-only for now (see SPEC.md §6.4), so the
  // container forces a light background regardless of the VS Code theme.
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
              background: #f8fafc;
              color: #0f172a;
              font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
              padding: 1.5rem;
            }
            #root {
              max-width: 720px;
              margin: 0 auto;
            }
          </style>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`;
}
