import { ImportWizard, type ImportMode } from "@pretextbook/import/react";
import "@pretextbook/import/react.css";
import {
  assetsForImportMode,
  filesForImportMode,
  formatWarningLine,
  type ImportedProjectSuccess,
} from "@pretextbook/import";

type VscodeApi = {
  postMessage: (message: unknown) => void;
};

declare const acquireVsCodeApi: undefined | (() => VscodeApi);

// Store the API in window to persist across hot reloads
declare global {
  interface Window {
    __vscodeApi?: VscodeApi;
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

/**
 * VS Code-specific wrapper for the ImportWizard component. The whole import
 * pipeline runs inside the webview (a browser context); on confirm we resolve
 * the chosen mode to a concrete file map and post it to the extension host,
 * which picks a destination folder and writes the files.
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

  return <ImportWizard onConfirm={handleConfirm} onCancel={handleCancel} />;
}

export default VsCodeImportApp;
