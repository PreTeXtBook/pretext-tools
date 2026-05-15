import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImportUploadPanel } from "@pretextbook/project-import/react";
import type { ImportedProjectResult } from "@pretextbook/project-import";

function formatSize(charCount: number): string {
  if (charCount < 1024) {
    return `${charCount} chars`;
  }
  if (charCount < 1024 * 1024) {
    return `${(charCount / 1024).toFixed(1)} KB`;
  }
  return `${(charCount / (1024 * 1024)).toFixed(2)} MB`;
}

function App() {
  const [result, setResult] = useState<ImportedProjectResult | null>(null);

  const resultSummary = useMemo(() => {
    if (!result) {
      return "Upload a file to run the import smoke test.";
    }

    if ("pretextError" in result) {
      return `Conversion failed: ${result.pretextError}`;
    }

    return `Conversion succeeded from ${result.sourcePath} (${formatSize(
      result.pretextSource.length,
    )})`;
  }, [result]);

  const pretextSource =
    result && "pretextSource" in result ? result.pretextSource : "";

  return (
    <main className="smoke-page">
      <header className="smoke-header">
        <h1>PreTeXt Import UI Smoke Test</h1>
        <p>
          Testing page for <code>@pretextbook/project-import</code> React upload
          components.
        </p>
        <nav>
          <a href="/">Open AST Playground</a>
        </nav>
      </header>

      <section className="smoke-grid">
        <article className="card upload-card">
          <ImportUploadPanel onImport={setResult} />
        </article>

        <article className="card summary-card">
          <h2>Result Summary</h2>
          <p>{resultSummary}</p>
          {result && "pretextSource" in result ? (
            <ul>
              <li>
                <strong>Main source:</strong> {result.sourcePath}
              </li>
              <li>
                <strong>Source type:</strong> {result.sourceType}
              </li>
              <li>
                <strong>Detected format:</strong> {result.detectedSourceFormat}
              </li>
              <li>
                <strong>Files extracted:</strong> {Object.keys(result.files).length}
              </li>
            </ul>
          ) : null}
        </article>
      </section>

      <section className="card output-card">
        <h2>Converted PreTeXt</h2>
        <textarea
          className="output"
          readOnly
          value={pretextSource}
          placeholder="Converted PreTeXt output appears here after a successful upload."
        />
      </section>

      <section className="card output-card">
        <h2>Raw Result JSON</h2>
        <pre className="json-output">
          {result ? JSON.stringify(result, null, 2) : "(no result yet)"}
        </pre>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element for import smoke test.");
}

createRoot(rootElement).render(<App />);
