import { useEffect, useState } from "react";
import { VisualEditor } from "@pretextbook/visual-editor";
import "@pretextbook/visual-editor/styles";

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

/**
 * VS Code-specific wrapper for the VisualEditor component.
 * Handles communication with the VS Code extension host.
 */
function VsCodeApp() {

  const [content, setContent] = useState("");

  useEffect(() => {
    if (!vscode) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; text?: string };
      if (message.type === "update" || message.type === "load") {
        setContent(message.text ?? "");
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [vscode]);

  const handleChange = (ptx: string) => {
    setContent(ptx);
    vscode?.postMessage({ type: "update", value: ptx });
  };

  return <VisualEditor content={content} onChange={handleChange} />;
}

export default VsCodeApp;
