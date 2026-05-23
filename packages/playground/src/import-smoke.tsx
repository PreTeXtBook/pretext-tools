import { useMemo, useState } from "react";
import { JsonView, collapseAllNested, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { createRoot } from "react-dom/client";
import { ImportUploadPanel, ImportWizard } from "@pretextbook/import/react";
import "@pretextbook/import/react.css";
import type { ImportedProjectResult, ImportedProjectSuccess } from "@pretextbook/import";
import type { ImportMode } from "@pretextbook/import/react";

function formatSize(charCount: number): string {
  if (charCount < 1024) {
    return `${charCount} chars`;
  }
  if (charCount < 1024 * 1024) {
    return `${(charCount / 1024).toFixed(1)} KB`;
  }
  return `${(charCount / (1024 * 1024)).toFixed(2)} MB`;
}

function WizardDemo() {
  const [confirmed, setConfirmed] = useState<{
    result: ImportedProjectSuccess;
    mode: ImportMode;
  } | null>(null);

  return (
    <section className="card output-card">
      <h2>ImportWizard Demo</h2>
      <div style={{ maxWidth: 520 }}>
        <ImportWizard
          onConfirm={(result, mode) => setConfirmed({ result, mode })}
        />
      </div>
      {confirmed ? (
        <div style={{ marginTop: 16 }}>
          <p>
            <strong>Confirmed:</strong> mode={confirmed.mode}, kind=
            {confirmed.result.documentKind}, files=
            {Object.keys(confirmed.result.outputFiles).length}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function App() {
  const [result, setResult] = useState<ImportedProjectResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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

  const outputFilePaths =
    result && "outputFiles" in result
      ? Object.keys(result.outputFiles).sort()
      : [];

  const visibleOutputFile =
    result && "outputFiles" in result && selectedFile
      ? result.outputFiles[selectedFile]
      : "";

  return (
    <main className="smoke-page">
      <WizardDemo />
      <header className="smoke-header">
        <h1>PreTeXt Import UI Smoke Test (debug)</h1>
        <p>
          Testing page for <code>@pretextbook/import</code> React upload
          components.
        </p>
        <nav>
          <a href="/">Open AST Playground</a>
        </nav>
      </header>

      <section className="smoke-grid">
        <article className="card upload-card">
          <ImportUploadPanel
            onImport={(r) => {
              setResult(r);
              if ("outputFiles" in r) {
                const keys = Object.keys(r.outputFiles).sort();
                const preferred = keys.find((k) => k.endsWith("/main.ptx")) ?? keys[0];
                setSelectedFile(preferred ?? null);
              } else {
                setSelectedFile(null);
              }
            }}
          />
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
                <strong>Document kind:</strong> {result.documentKind}
              </li>
              <li>
                <strong>Detected format:</strong> {result.detectedSourceFormat}
              </li>
              <li>
                <strong>Files extracted:</strong> {Object.keys(result.files).length}
              </li>
              <li>
                <strong>Output files:</strong> {Object.keys(result.outputFiles).length}
              </li>
              <li>
                <strong>Output assets:</strong> {Object.keys(result.outputAssets).length}
              </li>
              <li>
                <strong>Warnings:</strong> {result.warnings.length}
              </li>
            </ul>
          ) : null}
        </article>
      </section>

      {outputFilePaths.length > 0 ? (
        <section className="card output-card">
          <h2>Project Files</h2>
          <label>
            File:&nbsp;
            <select
              value={selectedFile ?? ""}
              onChange={(e) => setSelectedFile(e.currentTarget.value)}
            >
              {outputFilePaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="output"
            readOnly
            value={visibleOutputFile}
            placeholder="Select a file to view its contents."
          />
        </section>
      ) : null}

      <section className="card output-card">
        <h2>Converted PreTeXt (main)</h2>
        <textarea
          className="output"
          readOnly
          value={pretextSource}
          placeholder="Converted PreTeXt output appears here after a successful upload."
        />
      </section>

      {result && "warnings" in result && result.warnings.length > 0 ? (
        <section className="card output-card">
          <h2>Warnings</h2>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>
                <code>{w.action}</code> {w.kind}/{w.category}{" "}
                <strong>{w.macro}</strong> ×{w.occurrences}
                {w.message ? ` — ${w.message}` : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card output-card">
        <h2>Raw Result JSON</h2>
        {result ? (
          <JsonView
            data={
              JSON.parse(
                JSON.stringify(result, (_key, value) =>
                  value instanceof Uint8Array
                    ? `Uint8Array(${value.length} bytes)`
                    : value,
                ),
              )
            }
            shouldExpandNode={collapseAllNested}
            style={defaultStyles}
          />
        ) : (
          <p className="placeholder">No result yet.</p>
        )}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element for import smoke test.");
}

createRoot(rootElement).render(<App />);
