import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { PRETEXT_LATEX_LANGUAGE_ID } from "@pretextbook/latex-style-pretext";
import {
  registerPretextLatex,
  wireDiagnostics,
  SAMPLE_DOCUMENT,
} from "./monaco-latex";

// Monaco needs a base editor worker; we register our own language so no
// language-specific workers are required.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

registerPretextLatex(monaco);

const container = document.getElementById("editor")!;
const editor = monaco.editor.create(container, {
  value: SAMPLE_DOCUMENT,
  language: PRETEXT_LATEX_LANGUAGE_ID,
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  wordWrap: "on",
  scrollBeyondLastLine: false,
  quickSuggestions: { other: true, comments: false, strings: true },
});

const model = editor.getModel();
if (model) {
  wireDiagnostics(monaco, model);
}

// Match Monaco's theme to the page's light/dark preference.
const applyTheme = (dark: boolean) =>
  monaco.editor.setTheme(dark ? "vs-dark" : "vs");
const media = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(media.matches);
media.addEventListener("change", (e) => applyTheme(e.matches));
