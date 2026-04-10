/**
 * Live Preview Panel for PreTeXt documents.
 *
 * Opens a side-by-side WebviewPanel that embeds the PreTeXt local
 * development server (started via `pretext view <target>`). Supports:
 *
 * - Auto-refresh after build completion
 * - Forward search (source -> preview) via xml:id scrolling
 * - Inverse search (preview -> source) via double-click on xml:id elements
 * - Auto-rebuild on .ptx file save (configurable)
 */

import {
  Disposable,
  Range,
  Selection,
  Uri,
  ViewColumn,
  WebviewPanel,
  commands,
  env,
  extensions,
  window,
  workspace,
} from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { cli } from "./cli";
import { ensureProjectList, projectTargetList } from "./project";
import { pretextOutputChannel, ptxSBItem } from "./ui";
import * as utils from "./utils";

// Module-level state
let currentPanel: WebviewPanel | undefined;
let viewProcess: ChildProcess | undefined;
let fileWatcher: Disposable | undefined;
let serverUrl: string | undefined;
let buildInProgress = false;
let buildDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let currentTarget: string | undefined;
let currentProjectPath: string | undefined;
let lastPtxEditor: import("vscode").TextEditor | undefined;
let editorTracker: Disposable | undefined;

const BUILD_DEBOUNCE_MS = 1000;

/**
 * Command handler: Open live preview in a side panel.
 * Prompts for target, starts the view server, opens a WebviewPanel.
 */
export async function cmdLivePreview(): Promise<void> {
  // If panel already exists, just reveal it
  if (currentPanel) {
    currentPanel.reveal(ViewColumn.Beside);
    return;
  }

  ensureProjectList();
  const targetSelection = projectTargetList({});

  const qpSelection = await window.showQuickPick(targetSelection);
  if (!qpSelection) {
    return;
  }

  currentTarget = qpSelection.label;
  currentProjectPath = qpSelection.description || "";

  pretextOutputChannel.appendLine(
    `Starting live preview for target: ${currentTarget}`,
  );

  // PDF and braille targets can't use the HTML server — open the file directly
  if (currentTarget === "pdf" || currentTarget === "print") {
    await openFilePreview(currentTarget, currentProjectPath, ".pdf");
  } else if (currentTarget === "braille") {
    await openFilePreview(currentTarget, currentProjectPath, ".brf");
  } else if (currentTarget === "epub") {
    // If an EPUB viewer extension is installed, open in VS Code; otherwise open externally
    const hasEpubViewer = extensions.all.some(
      (ext) => ext.id.toLowerCase().includes("epub"),
    );
    if (hasEpubViewer) {
      await openFilePreview(currentTarget, currentProjectPath, ".epub");
    } else {
      await openFileExternally(currentTarget, currentProjectPath, ".epub");
    }
  } else {
    await startViewServer(currentTarget, currentProjectPath);
  }
}

/**
 * Open a file with the system's default external application.
 * Used for formats like EPUB that have no VS Code viewer.
 */
async function openFileExternally(
  target: string,
  projectPath: string,
  extension: string,
): Promise<void> {
  const outputDir = path.join(projectPath, "output", target);
  let outputFile: string | undefined;

  try {
    const files = fs.readdirSync(outputDir);
    outputFile = files.find((f) => f.endsWith(extension));
  } catch {
    // not found
  }

  if (!outputFile) {
    pretextOutputChannel.appendLine(
      `[External Preview] No ${extension} file found, running build...`,
    );
    const buildResult = await new Promise<boolean>((resolve) => {
      const fullCommand = cli.cmd() + " build " + target;
      const buildProcess = spawn(fullCommand, [], {
        cwd: projectPath,
        shell: true,
      });
      buildProcess.on("close", (code) => resolve(code === 0));
    });

    if (buildResult) {
      try {
        const files = fs.readdirSync(outputDir);
        outputFile = files.find((f) => f.endsWith(extension));
      } catch {
        // still not found
      }
    }

    if (!outputFile) {
      window.showErrorMessage(
        `Could not find or build a ${extension} file. Check the PreTeXt output log.`,
      );
      return;
    }
  }

  const filePath = path.join(outputDir, outputFile);
  pretextOutputChannel.appendLine(
    `[External Preview] Opening in system viewer: ${filePath}`,
  );
  env.openExternal(Uri.file(filePath));
}

/**
 * Open a non-HTML output file (PDF, BRF) directly in VS Code.
 * Sets up a file watcher to auto-rebuild on save and reopen.
 */
async function openFilePreview(
  target: string,
  projectPath: string,
  extension: string,
): Promise<void> {
  const outputDir = path.join(projectPath, "output", target);
  let outputFile: string | undefined;

  try {
    const files = fs.readdirSync(outputDir);
    outputFile = files.find((f) => f.endsWith(extension));
  } catch {
    pretextOutputChannel.appendLine(
      `[File Preview] Output directory not found, building first...`,
    );
  }

  if (!outputFile) {
    pretextOutputChannel.appendLine(
      `[File Preview] No ${extension} file found, running build...`,
    );
    const buildResult = await new Promise<boolean>((resolve) => {
      const fullCommand = cli.cmd() + " build " + target;
      const buildProcess = spawn(fullCommand, [], {
        cwd: projectPath,
        shell: true,
      });
      buildProcess.on("close", (code) => resolve(code === 0));
    });

    if (buildResult) {
      try {
        const files = fs.readdirSync(outputDir);
        outputFile = files.find((f) => f.endsWith(extension));
      } catch {
        // still not found
      }
    }

    if (!outputFile) {
      window.showErrorMessage(
        `Could not find or build a ${extension} file. Check the PreTeXt output log.`,
      );
      return;
    }
  }

  const filePath = path.join(outputDir, outputFile);
  pretextOutputChannel.appendLine(
    `[File Preview] Opening: ${filePath}`,
  );

  const fileUri = Uri.file(filePath);
  await commands.executeCommand("vscode.open", fileUri, { viewColumn: ViewColumn.Beside, preview: true });

  // Set up file watcher for auto-rebuild
  if (fileWatcher) {
    fileWatcher.dispose();
  }
  fileWatcher = workspace.onDidSaveTextDocument((document) => {
    if (!document.fileName.match(/\.(ptx|xml)$/)) {
      return;
    }
    const autoCompile: boolean =
      workspace
        .getConfiguration("pretext-tools")
        .get("livePreview.autoCompile") ?? true;
    if (!autoCompile) {
      return;
    }
    if (buildInProgress) {
      return;
    }
    if (buildDebounceTimer) {
      clearTimeout(buildDebounceTimer);
    }
    buildDebounceTimer = setTimeout(() => {
      triggerFileBuildAndReopen(target, projectPath, filePath);
    }, BUILD_DEBOUNCE_MS);
  });
}

/**
 * Build a non-HTML target and reopen the output file.
 */
function triggerFileBuildAndReopen(
  target: string,
  projectPath: string,
  filePath: string,
): void {
  if (buildInProgress) {
    return;
  }
  buildInProgress = true;
  utils.updateStatusBarItem(ptxSBItem, "building");
  pretextOutputChannel.appendLine(
    `[File Preview] Auto-building target: ${target}`,
  );

  const fullCommand = cli.cmd() + " build " + target;
  const buildProcess = spawn(fullCommand, [], {
    cwd: projectPath,
    shell: true,
  });

  buildProcess.stdout?.on("data", (data: Buffer) => {
    pretextOutputChannel.appendLine(utils.stripColorCodes(data.toString()));
  });
  buildProcess.stderr?.on("data", (data: Buffer) => {
    const text = utils.stripColorCodes(data.toString());
    if (text.trim()) {
      pretextOutputChannel.appendLine(`[build stderr] ${text}`);
    }
  });

  buildProcess.on("close", (code: number | null) => {
    buildInProgress = false;
    if (code === 0) {
      pretextOutputChannel.appendLine(
        "[File Preview] Build complete. Reopening file.",
      );
      utils.updateStatusBarItem(ptxSBItem, "success");
      const fileUri = Uri.file(filePath);
      commands.executeCommand("vscode.open", fileUri, { viewColumn: ViewColumn.Beside, preview: true });
    } else {
      pretextOutputChannel.appendLine(
        `[File Preview] Build failed (code ${code}).`,
      );
      utils.updateStatusBarItem(ptxSBItem, "ready");
    }
  });
}

/**
 * Start `pretext view <target>` and open the WebviewPanel when ready.
 * Builds the target first if the output directory is missing or empty.
 */
async function startViewServer(
  target: string,
  projectPath: string,
): Promise<void> {
  // Check if the output exists; if not, build first
  const outputDir = path.join(projectPath, "output", target);
  let needsBuild = true;
  try {
    const files = fs.readdirSync(outputDir);
    needsBuild = !files.some((f) => f.endsWith(".html"));
  } catch {
    needsBuild = true;
  }

  if (needsBuild) {
    pretextOutputChannel.appendLine(
      `[Live Preview] No HTML output found for "${target}", building first...`,
    );
    pretextOutputChannel.show(); // Show the output channel so user sees build progress
    utils.updateStatusBarItem(ptxSBItem, "building");

    const buildOk = await new Promise<boolean>((resolve) => {
      const buildCmd = cli.cmd() + " build " + target;
      pretextOutputChannel.appendLine(`[Live Preview] Running: ${buildCmd}`);
      const proc = spawn(buildCmd, [], {
        cwd: projectPath,
        shell: true,
      });
      proc.stdout?.on("data", (data: Buffer) => {
        const text = utils.stripColorCodes(data.toString());
        if (text.trim()) {
          pretextOutputChannel.appendLine(text);
        }
      });
      proc.stderr?.on("data", (data: Buffer) => {
        const text = utils.stripColorCodes(data.toString());
        if (text.trim()) {
          pretextOutputChannel.appendLine(text);
        }
      });
      proc.on("close", (code) => {
        pretextOutputChannel.appendLine(
          `[Live Preview] Build process exited with code ${code}`,
        );
        resolve(true); // Always continue — check for output files below
      });
    });

    // Check if the build produced any HTML output, even if exit code was non-zero
    // (PreTeXt often exits 1 due to missing optional tools like Sage)
    let hasOutput = false;
    try {
      const files = fs.readdirSync(outputDir);
      hasOutput = files.some((f) => f.endsWith(".html"));
    } catch {
      hasOutput = false;
    }

    if (!hasOutput) {
      window.showErrorMessage(
        "PreTeXt build produced no HTML output. Check the output log for details.",
        "Show Log",
      ).then((choice) => {
        if (choice === "Show Log") {
          pretextOutputChannel.show();
        }
      });
      utils.updateStatusBarItem(ptxSBItem, "ready");
      return;
    }

    pretextOutputChannel.appendLine(
      `[Live Preview] Build complete. Starting preview server...`,
    );
  }

  // Use --restart-server to ensure we get a fresh server (handles stale servers)
  const fullCommand = cli.cmd() + " view --no-launch --restart-server " + target;

  pretextOutputChannel.appendLine(`Running: ${fullCommand}`);
  utils.updateStatusBarItem(ptxSBItem, "building");

  viewProcess = spawn(fullCommand, [], {
    cwd: projectPath,
    shell: true,
  });

  // Buffer to accumulate output for URL detection (data may arrive in chunks)
  let outputBuffer = "";

  function checkForServerUrl(text: string): void {
    outputBuffer += text;
    // Look for the target-specific URL
    const targetUrlMatch = outputBuffer.match(/(?:will be available|Opening browser).*?(https?:\/\/[^\s]*\/output\/[^\s]+)/);
    if (targetUrlMatch && !serverUrl) {
      serverUrl = targetUrlMatch[1];
      pretextOutputChannel.appendLine(`[Live Preview] Server ready at: ${serverUrl}`);
      utils.updateStatusBarItem(ptxSBItem, "success");
      injectInverseSearchScript(projectPath, target);
      openPreviewPanel(serverUrl, target);
      setupFileWatcher(target, projectPath);
    }
  }

  viewProcess.stdout?.on("data", (data: Buffer) => {
    const text = utils.stripColorCodes(data.toString());
    pretextOutputChannel.appendLine(text);
    checkForServerUrl(text);
  });

  viewProcess.stderr?.on("data", (data: Buffer) => {
    const text = utils.stripColorCodes(data.toString());
    if (text.trim()) {
      pretextOutputChannel.appendLine(text);
    }
    checkForServerUrl(text);
  });

  viewProcess.on("close", (code: number | null) => {
    pretextOutputChannel.appendLine(
      `[Live Preview] Server process exited (code ${code}). serverUrl=${serverUrl || "NOT DETECTED"}`,
    );
    if (!serverUrl) {
      pretextOutputChannel.appendLine(
        `[Live Preview] ERROR: Server exited without providing a URL. Accumulated output:\n${outputBuffer.substring(0, 1000)}`,
      );
      window.showErrorMessage(
        "PreTeXt server failed to start. Check the output log.",
        "Show Log",
      ).then((choice) => {
        if (choice === "Show Log") {
          pretextOutputChannel.show();
        }
      });
    }
    serverUrl = undefined;
    viewProcess = undefined;
    utils.updateStatusBarItem(ptxSBItem, "ready");
  });
}

/**
 * Create the WebviewPanel and load the preview.
 */
function openPreviewPanel(url: string, target: string): void {
  currentPanel = window.createWebviewPanel(
    "pretextLivePreview",
    `PreTeXt Preview: ${target}`,
    ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = getWebviewContent(url);

  // Handle messages from the webview
  currentPanel.webview.onDidReceiveMessage(
    (message: { command: string; id?: string; url?: string; text?: string }) => {
      pretextOutputChannel.appendLine(
        `[Extension] Received webview message: ${JSON.stringify(message)}`,
      );
      switch (message.command) {
        case "jumpToSource":
          if (message.id) {
            jumpToSourceByXmlId(message.id, message.text);
          }
          break;
        case "openExternal":
          if (message.url) {
            env.openExternal(Uri.parse(message.url));
          }
          break;
      }
    },
  );

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    disposeLivePreview();
  });

  // Track the last active .ptx editor so we can search it even when
  // the webview has focus (which sets activeTextEditor to undefined)
  if (editorTracker) {
    editorTracker.dispose();
  }
  // Capture the current editor before the webview takes focus
  if (window.activeTextEditor?.document.fileName.match(/\.(ptx|xml)$/)) {
    lastPtxEditor = window.activeTextEditor;
  }
  editorTracker = window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document.fileName.match(/\.(ptx|xml)$/)) {
      lastPtxEditor = editor;
    }
  });
}

/**
 * Generate the HTML for the WebviewPanel.
 *
 * The iframe loads content from the PreTeXt local server (cross-origin).
 * Communication uses window.postMessage which works across origins:
 * - Forward search: webview wrapper sends hash navigation to iframe
 * - Inverse search: injected script in the HTML files uses
 *   window.parent.postMessage to send clicked element IDs back
 */
function getWebviewContent(url: string): string {
  const escapedUrl = url.replace(/'/g, "\\'");
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '    <meta charset="UTF-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '    <title>PreTeXt Preview</title>',
    '    <style>',
    '        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }',
    '        #toolbar { height: 32px; background: var(--vscode-editorGroupHeader-tabsBackground); border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; padding: 0 8px; font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); }',
    '        #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; margin-right: 4px; cursor: pointer; font-size: 12px; border-radius: 2px; }',
    '        #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }',
    '        #status { margin-left: auto; opacity: 0.7; }',
    '        iframe { width: 100%; height: calc(100% - 33px); border: none; }',
    '    </style>',
    '</head>',
    '<body>',
    '    <div id="toolbar">',
    '        <button id="btn-refresh" title="Refresh preview">&#x21bb; Refresh</button>',
    '        <button id="btn-browser" title="Open in external browser">&#x2197; Browser</button>',
    '        <span id="status">Live Preview (click to jump to source)</span>',
    '    </div>',
    '    <iframe id="preview" src="' + url + '"></iframe>',
    '    <script>',
    '        (function() {',
    '            var vscode = acquireVsCodeApi();',
    '            var iframe = document.getElementById("preview");',
    '            var statusEl = document.getElementById("status");',
    '            var previewUrl = "' + escapedUrl + '";',
    '',
    '            document.getElementById("btn-refresh").addEventListener("click", function() {',
    '                iframe.src = previewUrl;',
    '                statusEl.textContent = "Refreshing...";',
    '                setTimeout(function() { statusEl.textContent = "Live Preview (click to jump to source)"; }, 2000);',
    '            });',
    '',
    '            document.getElementById("btn-browser").addEventListener("click", function() {',
    '                vscode.postMessage({ command: "openExternal", url: previewUrl });',
    '            });',
    '',
    '            // Listen for messages from BOTH the extension and the iframe',
    '            window.addEventListener("message", function(event) {',
    '                var message = event.data;',
    '                if (!message || !message.command) { return; }',
    '',
    '                if (message.command === "refresh") {',
    '                    iframe.src = previewUrl;',
    '                    statusEl.textContent = "Refreshing...";',
    '                    setTimeout(function() { statusEl.textContent = "Live Preview (click to jump to source)"; }, 2000);',
    '                }',
    '',
    '                if (message.command === "scrollTo" && message.id) {',
    '                    console.log("[WebviewWrapper] scrollTo:", message.id);',
    '                    try {',
    '                        iframe.contentWindow.postMessage({ command: "scrollTo", id: message.id }, "*");',
    '                    } catch(e) {',
    '                        console.log("[WebviewWrapper] postMessage to iframe failed, using hash:", e);',
    '                        var u = previewUrl.split("#")[0] + "#" + message.id;',
    '                        iframe.src = u;',
    '                    }',
    '                }',
    '',
    '                // Navigate to a specific HTML page and scroll to an element',
    '                if (message.command === "navigateAndScroll" && message.file && message.id) {',
    '                    console.log("[WebviewWrapper] navigateAndScroll:", message.file, message.id);',
    '                    var baseUrl = previewUrl.endsWith("/") ? previewUrl : previewUrl + "/";',
    '                    var targetUrl = baseUrl + message.file + "#" + message.id;',
    '                    console.log("[WebviewWrapper] Loading:", targetUrl);',
    '                    iframe.src = targetUrl;',
    '                }',
    '',
    '                // Inverse search: the iframe sends this via window.parent.postMessage',
    '                if (message.command === "jumpToSource" && message.id) {',
    '                    console.log("[WebviewWrapper] received jumpToSource for id:", message.id, "text:", message.text);',
    '                    vscode.postMessage({ command: "jumpToSource", id: message.id, text: message.text || "" });',
    '                }',
    '            });',
    '        })();',
    '    </script>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Inject a small inverse-search script into the built HTML files.
 * This script adds double-click handlers that send the clicked element's
 * ID to the parent webview via window.parent.postMessage (works cross-origin).
 */
function injectInverseSearchScript(projectPath: string, target: string): void {
  // Find the HTML output directory
  const outputDir = path.join(projectPath, "output", target);
  if (!fs.existsSync(outputDir)) {
    pretextOutputChannel.appendLine(
      `[Inverse Search] Output directory not found: ${outputDir}`,
    );
    return;
  }

  const scriptTag = [
    '<script data-pretext-tools-inverse-search="true">',
    '(function() {',
    '  if (window.__pretextInverseSearchInjected) return;',
    '  window.__pretextInverseSearchInjected = true;',
    '  var lastHighlighted = null;',
    '',
    '  function findIdAncestor(el) {',
    '    while (el && el !== document.body && el !== document.documentElement) {',
    '      if (el.id && el.id.length > 0) return el;',
    '      el = el.parentElement;',
    '    }',
    '    return null;',
    '  }',
    '',
    '  // Hover highlight',
    '  document.addEventListener("mouseover", function(e) {',
    '    var target = findIdAncestor(e.target);',
    '    if (lastHighlighted && lastHighlighted !== target) {',
    '      lastHighlighted.style.outline = "";',
    '    }',
    '    if (target) {',
    '      target.style.outline = "2px solid rgba(0,122,204,0.4)";',
    '      lastHighlighted = target;',
    '    }',
    '  });',
    '',
    '  document.addEventListener("mouseout", function(e) {',
    '    if (lastHighlighted) {',
    '      lastHighlighted.style.outline = "";',
    '      lastHighlighted = null;',
    '    }',
    '  });',
    '',
    '  // Forward search: parent webview sends scrollTo messages',
    '  window.addEventListener("message", function(event) {',
    '    var msg = event.data;',
    '    if (msg && msg.command === "scrollTo" && msg.id) {',
    '      console.log("[ForwardSearch] scrollTo:", msg.id);',
    '      var el = document.getElementById(msg.id);',
    '      if (el) {',
    '        el.scrollIntoView({ behavior: "instant", block: "center" });',
    '        el.style.outline = "3px solid #007acc";',
    '        setTimeout(function() { el.style.outline = ""; }, 2000);',
    '      } else {',
    '        console.log("[ForwardSearch] element not found:", msg.id);',
    '      }',
    '    }',
    '  });',
    '',
    '  // Single click anywhere — find nearest ancestor with an id and jump',
    '  document.addEventListener("click", function(e) {',
    '    if (e.target.tagName === "A" || e.target.closest("a")) return;',
    '    var target = findIdAncestor(e.target);',
    '    if (target) {',
    '      e.preventDefault();',
    '      target.style.outline = "3px solid #d4a017";',
    '      setTimeout(function() { target.style.outline = ""; }, 1500);',
    '      // Extract a text snippet from the clicked element for text-based search',
    '      var textSnippet = "";',
    '      var clickedEl = e.target.closest(".para, p, div.para") || e.target;',
    '      if (clickedEl) {',
    '        textSnippet = (clickedEl.textContent || "").trim().substring(0, 80);',
    '      }',
    '      window.parent.postMessage({',
    '        command: "jumpToSource",',
    '        id: target.id,',
    '        text: textSnippet',
    '      }, "*");',
    '    }',
    '  }, true);',
    '})();',
    '</script>',
  ].join('\n');

  // Find all .html files in the output directory
  let htmlFiles: string[];
  try {
    htmlFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith(".html"));
  } catch {
    return;
  }

  let injectedCount = 0;
  for (const file of htmlFiles) {
    const filePath = path.join(outputDir, file);
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      // Don't inject twice
      if (content.includes('data-pretext-tools-inverse-search')) {
        continue;
      }
      // Inject before </body>
      content = content.replace("</body>", scriptTag + "\n</body>");
      fs.writeFileSync(filePath, content, "utf-8");
      injectedCount++;
    } catch {
      // Skip files we can't read/write
    }
  }
  if (injectedCount > 0) {
    pretextOutputChannel.appendLine(
      `[Inverse Search] Injected handlers into ${injectedCount} HTML file(s)`,
    );
  }
}

/**
 * Set up a file watcher that auto-rebuilds on .ptx file save.
 */
function setupFileWatcher(target: string, projectPath: string): void {
  if (fileWatcher) {
    fileWatcher.dispose();
  }

  fileWatcher = workspace.onDidSaveTextDocument((document) => {
    if (!document.fileName.match(/\.(ptx|xml)$/)) {
      return;
    }

    const autoCompile: boolean =
      workspace
        .getConfiguration("pretext-tools")
        .get("livePreview.autoCompile") ?? true;

    if (!autoCompile) {
      return;
    }

    // Debounce rapid saves
    if (buildInProgress) {
      return;
    }
    if (buildDebounceTimer) {
      clearTimeout(buildDebounceTimer);
    }

    buildDebounceTimer = setTimeout(() => {
      triggerBuildAndRefresh(target, projectPath);
    }, BUILD_DEBOUNCE_MS);
  });
}

/**
 * Run `pretext build <target>`, then refresh the preview on success.
 */
function triggerBuildAndRefresh(
  target: string,
  projectPath: string,
): void {
  if (buildInProgress) {
    return;
  }
  buildInProgress = true;
  utils.updateStatusBarItem(ptxSBItem, "building");
  pretextOutputChannel.appendLine(
    `[Live Preview] Auto-building target: ${target}`,
  );

  const fullCommand = cli.cmd() + " build " + target;
  const buildProcess = spawn(fullCommand, [], {
    cwd: projectPath,
    shell: true,
  });

  buildProcess.stdout?.on("data", (data: Buffer) => {
    pretextOutputChannel.appendLine(utils.stripColorCodes(data.toString()));
  });

  buildProcess.stderr?.on("data", (data: Buffer) => {
    const text = utils.stripColorCodes(data.toString());
    if (text.trim()) {
      pretextOutputChannel.appendLine(`[build stderr] ${text}`);
    }
  });

  buildProcess.on("close", (code: number | null) => {
    buildInProgress = false;
    if (code === 0) {
      pretextOutputChannel.appendLine(
        "[Live Preview] Build complete. Refreshing preview.",
      );
      utils.updateStatusBarItem(ptxSBItem, "success");
      injectInverseSearchScript(projectPath, target);
      refreshPreview();
    } else {
      pretextOutputChannel.appendLine(
        `[Live Preview] Build failed (code ${code}).`,
      );
      utils.updateStatusBarItem(ptxSBItem, "ready");
      window.showWarningMessage(
        "PreTeXt build failed. Check the output log for details.",
        "Show Log",
      ).then((choice) => {
        if (choice === "Show Log") {
          pretextOutputChannel.show();
        }
      });
    }
  });
}

/**
 * Send a refresh message to the preview panel.
 */
export function refreshPreview(): void {
  if (currentPanel) {
    currentPanel.webview.postMessage({ command: "refresh" });
  }
}

/**
 * Forward search: scroll the preview to the element matching the
 * xml:id nearest to the cursor position in the active editor.
 */
export function cmdForwardSearch(): void {
  const editor = window.activeTextEditor;
  if (!editor || !currentPanel) {
    if (!currentPanel) {
      window.showInformationMessage(
        "Open a live preview first (Ctrl+Alt+L).",
      );
    }
    return;
  }

  const document = editor.document;
  const fullText = document.getText();
  const offset = document.offsetAt(editor.selection.active);

  // Extract ~300 chars of source text AFTER the cursor (the paragraph the user
  // is looking at), strip XML tags to get plain prose words.
  const contextEnd = Math.min(fullText.length, offset + 300);
  const rawContext = fullText.substring(offset, contextEnd);
  // Strip XML tags completely
  const plainContext = rawContext.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  // Extract distinctive words (5+ chars to avoid common short words like
  // "the", "and", "this"). Also skip XML-ish words.
  const skipWords = new Set(["xmlns", "pretext", "include"]);
  const words = plainContext
    .replace(/[^a-zA-Z\s-]/g, " ")  // keep hyphens for compound words
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !skipWords.has(w.toLowerCase()));

  pretextOutputChannel.appendLine(
    `[Forward Search] Context words: ${words.slice(0, 6).join(", ")}`,
  );

  if (words.length < 2) {
    // Fall back to nearest xml:id
    const idRegex = /xml:id=["']([^"']+)["']/g;
    let lastId: string | undefined;
    let match: RegExpExecArray | null;
    const textBefore = fullText.substring(0, offset);
    while ((match = idRegex.exec(textBefore)) !== null) {
      lastId = match[1];
    }
    if (lastId) {
      pretextOutputChannel.appendLine(
        `[Forward Search] Too few words, falling back to xml:id: ${lastId}`,
      );
      currentPanel.webview.postMessage({ command: "scrollTo", id: lastId });
    } else {
      window.showInformationMessage("No identifiable content near cursor.");
    }
    return;
  }

  // Search the HTML output files for these words to find the element ID + page
  const result = findHtmlIdByText(words.slice(0, 5));

  if (result) {
    pretextOutputChannel.appendLine(
      `[Forward Search] Found HTML element: ${result.id} in ${result.file}`,
    );
    // Navigate to the correct page and scroll to the element
    currentPanel.webview.postMessage({
      command: "navigateAndScroll",
      file: result.file,
      id: result.id,
    });
  } else {
    // Fall back to nearest xml:id
    const idRegex = /xml:id=["']([^"']+)["']/g;
    let lastId: string | undefined;
    let match: RegExpExecArray | null;
    const textBefore = fullText.substring(0, offset);
    while ((match = idRegex.exec(textBefore)) !== null) {
      lastId = match[1];
    }
    if (lastId) {
      pretextOutputChannel.appendLine(
        `[Forward Search] Text search failed, falling back to xml:id: ${lastId}`,
      );
      currentPanel.webview.postMessage({ command: "scrollTo", id: lastId });
    } else {
      window.showInformationMessage("Could not find matching content in preview.");
    }
  }
}

/**
 * Search all HTML output files for the given words and return the
 * nearest element ID that contains them.
 */
function findHtmlIdByText(words: string[]): { id: string; file: string } | undefined {
  if (!currentProjectPath || !currentTarget) {
    return undefined;
  }

  const htmlDir = path.join(currentProjectPath, "output", currentTarget);
  let htmlFiles: string[];
  try {
    htmlFiles = fs.readdirSync(htmlDir).filter(
      (f) => f.endsWith(".html") && f !== "index.html",
    );
  } catch {
    return undefined;
  }

  // Build a regex: word1.{1,120}?word2.{1,120}?word3...
  // Escape regex special chars in words (hyphens are literal in words like "cross-reference")
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const phrase = escaped.join("[\\s\\S]{1,120}?");
  const phraseRegex = new RegExp(phrase, "i");

  for (const file of htmlFiles) {
    const filePath = path.join(htmlDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const phraseMatch = phraseRegex.exec(content);
    if (!phraseMatch) {
      continue;
    }

    // Found the text. Now walk backward from the match to find the
    // nearest element with an id attribute.
    const before = content.substring(0, phraseMatch.index);
    const idMatches = [...before.matchAll(/\bid="([^"]+)"/g)];

    if (idMatches.length > 0) {
      const nearestId = idMatches[idMatches.length - 1][1];
      pretextOutputChannel.appendLine(
        `[Forward Search] Text "${words.slice(0, 3).join(" ")}" found in ${file}, nearest id: ${nearestId}`,
      );
      return { id: nearestId, file };
    }
  }

  return undefined;
}

/**
 * Inverse search: jump the editor to the source line containing
 * the given xml:id attribute.
 */
function jumpToSourceByXmlId(xmlId: string, textSnippet?: string): void {
  // PreTeXt's HTML output auto-generates IDs like "section-conclusions-2"
  // for paragraphs. The source only has "section-conclusions". We try the
  // exact ID first, then progressively strip trailing "-N" suffixes.
  const idsToTry = [xmlId];
  // Progressively strip ALL trailing -N suffixes
  let current = xmlId;
  while (true) {
    const stripped = current.replace(/-\d+$/, "");
    if (stripped === current) {
      break;
    }
    idsToTry.push(stripped);
    current = stripped;
  }
  // PreTeXt HTML may use the "label" attribute (with prefixes like "section-")
  // instead of xml:id. Also try stripping common prefixes.
  const prefixes = ["section-", "subsection-", "subsubsection-", "chapter-"];
  const baseIds = [...idsToTry];
  for (const id of baseIds) {
    for (const prefix of prefixes) {
      if (id.startsWith(prefix)) {
        const without = id.substring(prefix.length);
        if (without && !idsToTry.includes(without)) {
          idsToTry.push(without);
        }
      }
    }
  }
  // Also search for label="..." attribute in addition to xml:id="..."
  // (PreTeXt uses label for HTML id generation when present)

  pretextOutputChannel.appendLine(
    `[Inverse Search] Looking for: ${idsToTry.join(", ")}${textSnippet ? " | text: \"" + textSnippet.substring(0, 40) + "...\"" : ""}`,
  );

  // Use lastPtxEditor since the webview has focus (activeTextEditor is undefined)
  const editor = window.activeTextEditor?.document.fileName.match(/\.(ptx|xml)$/)
    ? window.activeTextEditor
    : lastPtxEditor;

  pretextOutputChannel.appendLine(
    `[Inverse Search] Editor: ${editor ? editor.document.fileName : "NONE"}`,
  );

  if (editor) {
    // Search for each candidate ID with text-based refinement.
    // Text refinement uses the paragraph's visible text to jump to
    // the exact line, even when the HTML ID numbering doesn't map
    // cleanly to source structure (proofs, corollaries, objectives, etc.)
    for (const id of idsToTry) {
      const found = searchDocumentForId(editor.document, id, textSnippet);
      if (found) {
        pretextOutputChannel.appendLine(
          `[Inverse Search] Found "${id}" in active editor`,
        );
        return;
      }
    }

    // No ID matched — try pure text search in the active editor
    if (textSnippet && textSnippet.length > 15) {
      const jumped = pureTextSearch(editor, textSnippet);
      if (jumped) {
        pretextOutputChannel.appendLine(
          `[Inverse Search] Found via pure text search in active editor`,
        );
        return;
      }
    }
  }

  // Search across all .ptx/xml files in the workspace
  pretextOutputChannel.appendLine(
    `[Inverse Search] Searching workspace files...`,
  );
  workspace.findFiles("**/*.{ptx,xml}", null, 100).then((files) => {
    for (const file of files) {
      workspace.openTextDocument(file).then((doc) => {
        // Try ID search first
        for (const id of idsToTry) {
          if (searchDocumentForId(doc, id, textSnippet)) {
            window.showTextDocument(doc, ViewColumn.One);
            pretextOutputChannel.appendLine(
              `[Inverse Search] Found "${id}" in ${doc.fileName}`,
            );
            return;
          }
        }
        // Try pure text search
        if (textSnippet && textSnippet.length > 15) {
          const text = doc.getText();
          const words = textSnippet
            .replace(/[^a-zA-Z\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 5);
          if (words.length >= 2) {
            const phrase = words.slice(0, 4).join("[\\s\\S]{1,60}?");
            const m = new RegExp(phrase, "i").exec(text);
            if (m) {
              window.showTextDocument(doc, ViewColumn.One).then((ed) => {
                const pos = doc.positionAt(m.index);
                ed.revealRange(new Range(pos, pos), 2);
                ed.selection = new Selection(pos, pos);
              });
              pretextOutputChannel.appendLine(
                `[Inverse Search] Found via text in ${doc.fileName}`,
              );
              return;
            }
          }
        }
      });
    }
  });
}

/**
 * Pure text search: find paragraph text in the document without any ID.
 * Used when PreTeXt's auto-generated HTML IDs have no source counterpart.
 */
function pureTextSearch(
  editor: import("vscode").TextEditor,
  textSnippet: string,
): boolean {
  const document = editor.document;
  const text = document.getText();

  const words = textSnippet
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5);

  if (words.length < 2) {
    return false;
  }

  const phrase = words.slice(0, 4).join("[\\s\\S]{1,60}?");
  const m = new RegExp(phrase, "i").exec(text);
  if (m) {
    const pos = document.positionAt(m.index);
    pretextOutputChannel.appendLine(
      `[Inverse Search] Pure text match: "${words.slice(0, 4).join(" ")}" at line ${pos.line + 1}`,
    );
    editor.revealRange(new Range(pos, pos), 2);
    editor.selection = new Selection(pos, pos);
    return true;
  }

  return false;
}

/**
 * Read the HTML output and determine which <div class="para"> (0-indexed)
 * the given suffixed ID is within its parent block.
 * Returns -1 if not found.
 */
function getParaIndexFromHtml(suffixedId: string, parentId: string): number {
  if (!currentProjectPath || !currentTarget) {
    return -1;
  }
  const htmlDir = path.join(currentProjectPath, "output", currentTarget);
  // Find the HTML file (usually the main content file, not index.html)
  let htmlFiles: string[];
  try {
    htmlFiles = fs.readdirSync(htmlDir).filter(
      (f) => f.endsWith(".html") && f !== "index.html",
    );
  } catch {
    return -1;
  }

  for (const file of htmlFiles) {
    const filePath = path.join(htmlDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Find the parent block
    const parentPattern = new RegExp(`id="${escapeRegex(parentId)}"`);
    const parentMatch = parentPattern.exec(content);
    if (!parentMatch) {
      continue;
    }

    // Find all <div class="para" id="parentId-N"> within this block.
    // Bound the search by the next sibling section (look for <section with
    // a different id than our parent).
    const afterParent = content.substring(parentMatch.index);
    // Find next <section that's not our block (next sibling or parent closing)
    const nextSectionRegex = new RegExp(
      `<section[^>]+id="(?!${escapeRegex(parentId)})`,
    );
    const nextSection = nextSectionRegex.exec(afterParent.substring(100));
    const blockHtml = nextSection
      ? afterParent.substring(0, 100 + nextSection.index)
      : afterParent.substring(0, 20000);

    // Count <div class="para"> elements to find which one has our ID
    const paraRegex = new RegExp(
      `<div class="para" id="(${escapeRegex(parentId)}-\\d+)"`,
      "g",
    );
    let paraCount = 0;
    let m: RegExpExecArray | null;
    while ((m = paraRegex.exec(blockHtml)) !== null) {
      paraCount++;
      if (m[1] === suffixedId) {
        pretextOutputChannel.appendLine(
          `[Inverse Search] HTML para "${suffixedId}" is the #${paraCount} <div class="para"> in "${parentId}"`,
        );
        return paraCount;
      }
    }
  }

  return -1;
}

/**
 * Jump to the Nth <p> tag within a source block identified by xml:id.
 */
function jumpToNthPara(
  editor: import("vscode").TextEditor,
  blockId: string,
  paraIndex: number,
): boolean {
  const document = editor.document;
  const text = document.getText();

  // Find where the block starts
  const blockPattern = new RegExp(`xml:id=["']${escapeRegex(blockId)}["']`);
  const blockMatch = blockPattern.exec(text);
  if (!blockMatch) {
    return false;
  }

  const searchStart = blockMatch.index;

  // Find the end of this block: next <section, <subsection, or <subsubsection
  // (not figures/tables/equations which are children of the block)
  const afterBlock = text.substring(searchStart + 1);
  const nextSectionMatch = afterBlock.match(/<(?:section|subsection|subsubsection|paragraphs)\s/);
  const searchEnd = nextSectionMatch
    ? searchStart + 1 + nextSectionMatch.index!
    : text.length;
  const blockText = text.substring(searchStart, searchEnd);

  // Count <p> tags (these map to <div class="para"> in HTML)
  const pRegex = /<p\b/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(blockText)) !== null) {
    count++;
    if (count === paraIndex) {
      const absoluteIdx = searchStart + m.index;
      const pos = document.positionAt(absoluteIdx);
      pretextOutputChannel.appendLine(
        `[Inverse Search] Para #${paraIndex} found at line ${pos.line + 1}`,
      );
      editor.revealRange(new Range(pos, pos), 2);
      editor.selection = new Selection(pos, pos);
      return true;
    }
  }

  pretextOutputChannel.appendLine(
    `[Inverse Search] Para #${paraIndex} not found in block "${blockId}" (counted ${count} <p> tags)`,
  );
  return false;
}

/**
 * Jump to the Nth child element within a block identified by xml:id.
 * PreTeXt's HTML output assigns IDs like "section-foo-2", "section-foo-4"
 * where the suffix is a counter of child elements. We count child block
 * elements (<p>, <figure>, <table>, <me>, <men>, <md>, <mdn>, <ol>, <ul>)
 * in the source to find the right one.
 */
function jumpToNthChild(
  editor: import("vscode").TextEditor,
  blockId: string,
  childIndex: number,
): boolean {
  const document = editor.document;
  const text = document.getText();

  // Find where the block starts
  const blockPattern = new RegExp(`xml:id=["']${escapeRegex(blockId)}["']`);
  const blockMatch = blockPattern.exec(text);
  if (!blockMatch) {
    return false;
  }

  const searchStart = blockMatch.index;

  // Find the end of this block (next section/subsection xml:id or end of file)
  const nextIdMatch = text.substring(searchStart + 1).match(/xml:id=["']/);
  const searchEnd = nextIdMatch
    ? searchStart + 1 + nextIdMatch.index!
    : text.length;
  const blockText = text.substring(searchStart, searchEnd);

  // Count block-level child elements in the source.
  // PreTeXt counts ALL direct children, including <p>, <figure>, <table>,
  // <me>, <men>, <md>, <mdn>, <tabular>, <ol>, <ul>, <dl>.
  // The heading itself is child #1, so suffix -2 is the first <p> after it.
  const childRegex = /<(p|figure|table|tabular|me|men|md|mdn|ol|ul|dl|image)\b/g;
  let count = 1; // Start at 1 (the heading/block itself)
  let match: RegExpExecArray | null;
  while ((match = childRegex.exec(blockText)) !== null) {
    count++;
    if (count === childIndex) {
      const absoluteIdx = searchStart + match.index;
      const pos = document.positionAt(absoluteIdx);
      pretextOutputChannel.appendLine(
        `[Inverse Search] Child #${childIndex} found at line ${pos.line + 1} (tag: <${match[1]}>)`,
      );
      editor.revealRange(new Range(pos, pos), 2);
      editor.selection = new Selection(pos, pos);
      return true;
    }
  }

  pretextOutputChannel.appendLine(
    `[Inverse Search] Child #${childIndex} not found in block "${blockId}" (counted ${count} children)`,
  );
  return false;
}

/**
 * After jumping to an xml:id, refine the cursor position by searching
 * for the paragraph's text content within the block. This gives
 * paragraph-level precision for inverse search.
 */
function refineSearchByText(
  editor: import("vscode").TextEditor,
  blockId: string,
  textSnippet: string,
): boolean {
  const document = editor.document;
  const text = document.getText();

  // Find where the block starts
  const blockPattern = new RegExp(`xml:id=["']${escapeRegex(blockId)}["']`);
  const blockMatch = blockPattern.exec(text);
  if (!blockMatch) {
    return false;
  }

  // The HTML text won't match the source directly because the source
  // has XML tags (<m>...</m>, <xref .../>) where the HTML has rendered
  // text. Extract just the longest plain-English words from the snippet
  // and search for those in the source, within the block's region.
  const searchStart = blockMatch.index;

  // Find the end of this block (next xml:id or end of file)
  const nextIdMatch = text.substring(searchStart + 1).match(/xml:id=["']/);
  const searchEnd = nextIdMatch
    ? searchStart + 1 + nextIdMatch.index!
    : text.length;
  const blockText = text.substring(searchStart, searchEnd);

  // Extract plain prose words (3+ chars, no math symbols) from the snippet
  const words = textSnippet
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  if (words.length === 0) {
    pretextOutputChannel.appendLine(
      `[Inverse Search] No searchable words in snippet`,
    );
    return false;
  }

  // Try progressively longer word sequences to find a unique match
  // Start with 3-4 consecutive long words
  for (let windowSize = Math.min(4, words.length); windowSize >= 2; windowSize--) {
    for (let start = 0; start <= words.length - windowSize; start++) {
      const phrase = words.slice(start, start + windowSize).join("\\s+(?:<[^>]*>\\s*)*");
      const phraseRegex = new RegExp(phrase, "i");
      const phraseMatch = phraseRegex.exec(blockText);
      if (phraseMatch) {
        const absoluteIdx = searchStart + phraseMatch.index;
        const pos = document.positionAt(absoluteIdx);
        pretextOutputChannel.appendLine(
          `[Inverse Search] Text match at line ${pos.line + 1} via words: "${words.slice(start, start + windowSize).join(" ")}"`,
        );
        editor.revealRange(new Range(pos, pos), 2);
        editor.selection = new Selection(pos, pos);
        return true;
      }
    }
  }

  pretextOutputChannel.appendLine(
    `[Inverse Search] Text refinement failed. Words tried: ${words.slice(0, 6).join(", ")}`,
  );
  return false;
}

/**
 * Search a document for xml:id="value" and reveal it if found.
 * Returns true if found.
 */
function searchDocumentForId(
  document: import("vscode").TextDocument,
  xmlId: string,
  textSnippet?: string,
): boolean {
  const text = document.getText();

  // Search for xml:id="value", id="value", or label="value"
  const patterns = [
    new RegExp(`xml:id=["']${escapeRegex(xmlId)}["']`),
    new RegExp(`\\blabel=["']${escapeRegex(xmlId)}["']`),
    new RegExp(`\\bid=["']${escapeRegex(xmlId)}["']`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      let jumpIdx = match.index;

      // If we have a text snippet, try to refine to the exact paragraph
      // Search the ENTIRE file since chunked HTML pages may combine content
      // from multiple source sections.
      if (textSnippet && textSnippet.length > 15) {
        const words = textSnippet
          .replace(/[^a-zA-Z\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 4);

        if (words.length >= 2) {
          const phrase = words.slice(0, 4).join("[\\s\\S]{1,60}?");
          const phraseRegex = new RegExp(phrase, "i");

          const phraseMatch = phraseRegex.exec(text);
          if (phraseMatch) {
            jumpIdx = phraseMatch.index;
            pretextOutputChannel.appendLine(
              `[searchDocumentForId] Text refined: "${words.slice(0, 4).join(" ")}" at offset ${jumpIdx}`,
            );
          }
        }
      }

      const pos = document.positionAt(jumpIdx);
      pretextOutputChannel.appendLine(
        `[searchDocumentForId] Jumping to line ${pos.line + 1}`,
      );
      const editor = window.activeTextEditor;
      if (editor && editor.document === document) {
        editor.revealRange(
          new Range(pos, pos),
          2, // TextEditorRevealType.InCenter
        );
        editor.selection = new Selection(pos, pos);
        return true;
      } else {
        // Open the document and jump
        window.showTextDocument(document, ViewColumn.One).then((ed) => {
          ed.revealRange(new Range(pos, pos), 2);
          ed.selection = new Selection(pos, pos);
        });
        return true;
      }
    }
  }
  return false;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Clean up all live preview resources.
 */
export function disposeLivePreview(): void {
  if (viewProcess && !viewProcess.killed) {
    viewProcess.kill();
    viewProcess = undefined;
  }
  // Stop the pretext view server if we have project info
  if (currentProjectPath && currentTarget) {
    try {
      const stopCmd = cli.cmd() + " view --stop-server " + currentTarget;
      spawn(stopCmd, [], { cwd: currentProjectPath, shell: true });
    } catch {
      // best effort
    }
  }
  if (fileWatcher) {
    fileWatcher.dispose();
    fileWatcher = undefined;
  }
  if (buildDebounceTimer) {
    clearTimeout(buildDebounceTimer);
    buildDebounceTimer = undefined;
  }
  if (editorTracker) {
    editorTracker.dispose();
    editorTracker = undefined;
  }
  serverUrl = undefined;
  currentTarget = undefined;
  currentProjectPath = undefined;
  lastPtxEditor = undefined;
}
