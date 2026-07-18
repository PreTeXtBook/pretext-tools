import {
  ImportWizard,
  type ImportEngine,
  type ImportMode,
} from "@pretextbook/import/react";
import "@pretextbook/import/react.css";
import {
  assetsForImportMode,
  filesForImportMode,
  formatWarningLine,
  handleImportUploadFile,
  type ImportedProjectResult,
  type ImportedProjectSuccess,
  type ImportProjectOptions,
} from "@pretextbook/import";

type VscodeApi = {
  postMessage: (message: unknown) => void;
};

declare const acquireVsCodeApi: undefined | (() => VscodeApi);

// Store the API in window to persist across hot reloads
declare global {
  interface Window {
    __vscodeApi?: VscodeApi;
    /** Host-injected config (see importWizardPanel.ts getHtmlForWebview). */
    __ptxImport?: { pandocAvailable?: boolean };
  }
}

// Acquire the VS Code API once at module load time
// Store it in window to prevent "API already acquired" errors during hot reloads
if (typeof window !== "undefined" && !window.__vscodeApi) {
  if (typeof acquireVsCodeApi === "function") {
    window.__vscodeApi = acquireVsCodeApi();
  }
}
const vscode = typeof window !== "undefined" ? window.__vscodeApi : undefined;

/** Message sent to the extension host when the user confirms an import. */
export interface ImportConfirmMessage {
  type: "import-confirm";
  mode: ImportMode;
  files: Record<string, string>;
  assetsBase64: Record<string, string>;
  sourceName: string;
  documentKind: string;
  warnings: string[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeAssets(
  assets: Record<string, Uint8Array>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(assets).map(([path, bytes]) => [path, toBase64(bytes)]),
  );
}

// ---------------------------------------------------------------------------
// Import engines
// ---------------------------------------------------------------------------

/** The built-in pure-TS pipeline that runs entirely in the webview. */
const builtinEngine: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  description: "Convert LaTeX, Markdown, or PreTeXt — no external tools needed.",
  acceptExtensions: [
    ".tex",
    ".md",
    ".markdown",
    ".ptx",
    ".xml",
    ".zip",
    ".gz",
    ".tar.gz",
    ".tgz",
  ],
  convertFile: handleImportUploadFile,
};

// Pandoc runs in the extension host, so the pandoc engine round-trips the file
// bytes there and awaits the converted result, correlated by requestId.
const pandocPending = new Map<
  string,
  {
    resolve: (result: ImportedProjectResult) => void;
    reject: (error: Error) => void;
  }
>();

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as
      | { type?: string; requestId?: string; result?: unknown; error?: string }
      | undefined;
    if (!message || message.type !== "pandoc-result" || !message.requestId) {
      return;
    }
    const pending = pandocPending.get(message.requestId);
    if (!pending) {
      return;
    }
    pandocPending.delete(message.requestId);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result as ImportedProjectResult);
    }
  });
}

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fileToBase64(file: File): Promise<string> {
  return toBase64(new Uint8Array(await file.arrayBuffer()));
}

const pandocEngine: ImportEngine = {
  id: "pandoc",
  label: "Pandoc",
  description:
    "Convert Word, OpenOffice, RST, EPUB, HTML, and more (requires a local pandoc install).",
  acceptExtensions: [
    ".docx",
    ".odt",
    ".rtf",
    ".epub",
    ".html",
    ".htm",
    ".rst",
    ".org",
    ".tex",
    ".md",
    ".markdown",
  ],
  convertFile: async (file: File, options: ImportProjectOptions) => {
    if (!vscode) {
      throw new Error("The pandoc converter is only available in VS Code.");
    }
    const requestId = makeRequestId();
    const dataBase64 = await fileToBase64(file);
    const result = new Promise<ImportedProjectResult>((resolve, reject) => {
      pandocPending.set(requestId, { resolve, reject });
    });
    vscode.postMessage({
      type: "pandoc-convert",
      requestId,
      fileName: file.name,
      dataBase64,
      options: {
        documentKind: options.documentKind,
        splitSections: options.splitSections,
      },
    });
    return result;
  },
};

const pandocAvailable =
  typeof window !== "undefined" && Boolean(window.__ptxImport?.pandocAvailable);
const engines: ImportEngine[] = pandocAvailable
  ? [builtinEngine, pandocEngine]
  : [builtinEngine];

/**
 * VS Code-specific wrapper for the ImportWizard component. The built-in engine
 * runs the whole pipeline in the webview; the pandoc engine round-trips to the
 * extension host. Either way, on confirm we resolve the chosen mode to a
 * concrete file map and post it to the host, which writes the files.
 */
function VsCodeImportApp() {
  const handleConfirm = (result: ImportedProjectSuccess, mode: ImportMode) => {
    const message: ImportConfirmMessage = {
      type: "import-confirm",
      mode,
      files: filesForImportMode(result, mode),
      assetsBase64: encodeAssets(assetsForImportMode(result, mode)),
      sourceName: result.sourceName,
      documentKind: result.documentKind,
      warnings: result.warnings.map(formatWarningLine),
    };
    vscode?.postMessage(message);
  };

  const handleCancel = () => {
    vscode?.postMessage({ type: "import-cancel" });
  };

  return (
    <ImportWizard
      engines={engines}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}

export default VsCodeImportApp;
