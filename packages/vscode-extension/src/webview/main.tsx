import { createRoot } from "react-dom/client";
import VsCodeApp from "./VsCodeApp";

// Note: StrictMode is disabled for VS Code webviews because it causes
// double mounting in development, which conflicts with acquireVsCodeApi()
// that can only be called once per webview session

createRoot(document.getElementById("root")!).render(<VsCodeApp />);
