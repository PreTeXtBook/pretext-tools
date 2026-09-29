import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { registerMonacoTypingShortcuts } from "@pretextbook/typing-shortcuts";

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

const SAMPLE_DOCUMENT = `<section xml:id="sec-intro">
  <title>Getting started</title>

  <p>
    Type $x^2$ here, or a comparison like a < b.
  </p>

</section>
`;

const container = document.getElementById("editor")!;
const editor = monaco.editor.create(container, {
  value: SAMPLE_DOCUMENT,
  // pretext-plus edits PreTeXt with Monaco's built-in XML mode.
  language: "xml",
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  wordWrap: "on",
  tabSize: 2,
  insertSpaces: true,
  scrollBeyondLastLine: false,
});

registerMonacoTypingShortcuts(monaco, editor);

// Handle for poking at the editor from the console (and browser tests).
(window as unknown as { editor: typeof editor }).editor = editor;

const applyTheme = (dark: boolean) =>
  monaco.editor.setTheme(dark ? "vs-dark" : "vs");
const media = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(media.matches);
media.addEventListener("change", (e) => applyTheme(e.matches));
