import { useMemo, useState } from 'react';
import {
  JsonView,
  collapseAllNested,
  defaultStyles,
} from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { createRoot } from 'react-dom/client';
import { ImportUploadPanel, ImportWizard } from '@pretextbook/import/react';
import '@pretextbook/import/react.css';
import {
  assetsForImportMode,
  divisionChildRefs,
  filesForImportMode,
  formatWarningLine,
  serializeProjectToPlusPayload,
} from '@pretextbook/import';
import type {
  ImportMode,
  ImportedProject,
  ImportedProjectResult,
  ImportedProjectSuccess,
} from '@pretextbook/import';

function formatSize(charCount: number): string {
  if (charCount < 1024) {
    return `${charCount} chars`;
  }
  if (charCount < 1024 * 1024) {
    return `${(charCount / 1024).toFixed(1)} KB`;
  }
  return `${(charCount / (1024 * 1024)).toFixed(2)} MB`;
}

/** Replacer for JsonView: summarize binary blobs instead of dumping them. */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (v instanceof Uint8Array) return `Uint8Array(${v.length} bytes)`;
      if (typeof v === 'string' && v.length > 2000) {
        return `${v.slice(0, 2000)}… (${v.length} chars)`;
      }
      return v;
    }),
  );
}

// ---------------------------------------------------------------------------
// Division pool inspector
// ---------------------------------------------------------------------------

function DivisionPoolView({ project }: { project: ImportedProject }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // A division is orphaned when it isn't the root and no other division's
  // placeholders reference it (SPEC §3.3 / §4.1).
  const referenced = useMemo(() => {
    const refs = new Set<string>();
    for (const division of project.divisions) {
      for (const ref of divisionChildRefs(division.content)) {
        refs.add(ref);
      }
    }
    return refs;
  }, [project]);

  const toggle = (xmlId: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(xmlId)) next.delete(xmlId);
      else next.add(xmlId);
      return next;
    });

  return (
    <div className="pool">
      <p className="pool-meta">
        <strong>{project.title || '(untitled)'}</strong> —{' '}
        {project.documentKind}, {project.divisions.length} division
        {project.divisions.length === 1 ? '' : 's'}, {project.assets.length}{' '}
        asset{project.assets.length === 1 ? '' : 's'}
      </p>

      {project.docinfo ? (
        <details className="pool-docinfo">
          <summary>docinfo ({formatSize(project.docinfo.length)})</summary>
          <pre>{project.docinfo}</pre>
        </details>
      ) : (
        <p className="pool-meta">No docinfo.</p>
      )}

      <ul className="pool-divisions">
        {project.divisions.map((division) => {
          const isOpen = openIds.has(division.xmlId);
          const isOrphan = !division.isRoot && !referenced.has(division.xmlId);
          const childRefs = divisionChildRefs(division.content);
          return (
            <li key={division.xmlId}>
              <button type="button" onClick={() => toggle(division.xmlId)}>
                <span className="pool-caret">{isOpen ? '▾' : '▸'}</span>
                {division.isRoot ? (
                  <span className="pool-badge root">root</span>
                ) : null}
                {isOrphan ? (
                  <span className="pool-badge orphan">orphan</span>
                ) : null}
                <code>{division.xmlId}</code>
                <span className="pool-type">{division.type}</span>
                <span className="pool-title">
                  {division.title || '(untitled)'}
                </span>
                <span className="pool-size">
                  {division.sourceFormat} ·{' '}
                  {formatSize(division.content.length)}
                </span>
              </button>
              {isOpen ? (
                <div className="pool-detail">
                  {childRefs.length > 0 ? (
                    <p className="pool-meta">
                      children:{' '}
                      {childRefs.map((r, i) => (
                        <code key={i}>{r}</code>
                      ))}
                    </p>
                  ) : null}
                  <pre>{division.content}</pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {project.assets.length > 0 ? (
        <table className="pool-assets">
          <thead>
            <tr>
              <th>ref</th>
              <th>file</th>
              <th>size</th>
            </tr>
          </thead>
          <tbody>
            {project.assets.map((asset) => (
              <tr key={asset.ref}>
                <td>
                  <code>{asset.ref}</code>
                </td>
                <td>{asset.fileName}</td>
                <td>{asset.data.length} bytes</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImportWizard demo — mirrors the shipping hosts
// ---------------------------------------------------------------------------

// Same shape as the VS Code webview's ImportConfirmMessage
// (packages/vscode-extension/src/webview-import/VsCodeImportApp.tsx), built
// with the same shared helpers. Base64 payloads are summarized for display.
function buildVsCodeMessage(result: ImportedProjectSuccess, mode: ImportMode) {
  const assets = assetsForImportMode(result, mode);
  return {
    type: 'import-confirm',
    mode,
    files: filesForImportMode(result, mode),
    assetsBase64: Object.fromEntries(
      Object.entries(assets).map(([path, bytes]) => [
        path,
        `base64(${bytes.length} bytes)`,
      ]),
    ),
    sourceName: result.sourceName,
    documentKind: result.documentKind,
    warnings: result.warnings.map(formatWarningLine),
  };
}

function WizardDemo() {
  const [confirmed, setConfirmed] = useState<{
    result: ImportedProjectSuccess;
    mode: ImportMode;
  } | null>(null);
  const [cancelCount, setCancelCount] = useState(0);
  // Force-remount the wizard on cancel, mirroring the VS Code host (which
  // disposes the whole panel on import-cancel).
  const [wizardKey, setWizardKey] = useState(0);

  const hostPayloads = useMemo(() => {
    if (!confirmed) return null;
    return {
      vscode: buildVsCodeMessage(confirmed.result, confirmed.mode),
      plus: serializeProjectToPlusPayload(confirmed.result.project),
    };
  }, [confirmed]);

  return (
    <section className="card output-card">
      <h2>ImportWizard (as shipped)</h2>
      <p className="pool-meta">
        The same component the VS Code webview panel hosts (and pretext-plus
        will), rendered in a matching 720px light container, with both{' '}
        <code>onConfirm</code> and <code>onCancel</code> wired. Confirming shows
        exactly what each host receives.
      </p>
      <div className="wizard-frame">
        <ImportWizard
          key={wizardKey}
          onConfirm={(result, mode) => setConfirmed({ result, mode })}
          onCancel={() => {
            setConfirmed(null);
            setCancelCount((n) => n + 1);
            setWizardKey((k) => k + 1);
          }}
        />
      </div>
      {cancelCount > 0 && !confirmed ? (
        <p className="pool-meta">
          Cancelled ×{cancelCount} — a host would close the panel/modal here.
        </p>
      ) : null}

      {confirmed && hostPayloads ? (
        <div className="host-payloads">
          <h3>
            Confirmed: mode={confirmed.mode}, kind=
            {confirmed.result.documentKind}
          </h3>

          <details open>
            <summary>
              Division pool (<code>result.project</code>)
            </summary>
            <DivisionPoolView project={confirmed.result.project} />
          </details>

          <details>
            <summary>
              VS Code host message (<code>import-confirm</code>,{' '}
              {Object.keys(hostPayloads.vscode.files).length} files)
            </summary>
            <JsonView
              data={jsonSafe(hostPayloads.vscode) as object}
              shouldExpandNode={collapseAllNested}
              style={defaultStyles}
            />
          </details>

          <details>
            <summary>
              pretext-plus payload (<code>serializeProjectToPlusPayload</code>,{' '}
              {hostPayloads.plus.divisions.length} divisions,{' '}
              {hostPayloads.plus.assets.length} assets)
            </summary>
            <JsonView
              data={jsonSafe(hostPayloads.plus) as object}
              shouldExpandNode={collapseAllNested}
              style={defaultStyles}
            />
          </details>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Raw pipeline debug page (ImportUploadPanel)
// ---------------------------------------------------------------------------

function App() {
  const [result, setResult] = useState<ImportedProjectResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const resultSummary = useMemo(() => {
    if (!result) {
      return 'Upload a file to run the import smoke test.';
    }

    if ('pretextError' in result) {
      return `Conversion failed: ${result.pretextError}`;
    }

    return `Conversion succeeded from ${result.sourcePath} (${formatSize(
      result.pretextSource.length,
    )})`;
  }, [result]);

  const pretextSource =
    result && 'pretextSource' in result ? result.pretextSource : '';

  const outputFilePaths =
    result && 'outputFiles' in result
      ? Object.keys(result.outputFiles).sort()
      : [];

  const visibleOutputFile =
    result && 'outputFiles' in result && selectedFile
      ? result.outputFiles[selectedFile]
      : '';

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
              if ('outputFiles' in r) {
                const keys = Object.keys(r.outputFiles).sort();
                const preferred =
                  keys.find((k) => k.endsWith('/main.ptx')) ?? keys[0];
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
          {result && 'pretextSource' in result ? (
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
                <strong>Files extracted:</strong>{' '}
                {Object.keys(result.files).length}
              </li>
              <li>
                <strong>Output files:</strong>{' '}
                {Object.keys(result.outputFiles).length}
              </li>
              <li>
                <strong>Output assets:</strong>{' '}
                {Object.keys(result.outputAssets).length}
              </li>
              <li>
                <strong>Warnings:</strong> {result.warnings.length}
              </li>
            </ul>
          ) : null}
        </article>
      </section>

      {result && 'project' in result ? (
        <section className="card output-card">
          <h2>Division Pool</h2>
          <DivisionPoolView project={result.project} />
        </section>
      ) : null}

      {outputFilePaths.length > 0 ? (
        <section className="card output-card">
          <h2>Project Files</h2>
          <label>
            File:&nbsp;
            <select
              value={selectedFile ?? ''}
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

      {result && 'warnings' in result && result.warnings.length > 0 ? (
        <section className="card output-card">
          <h2>Warnings</h2>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>
                <code>{w.action}</code> {w.kind}/{w.category}{' '}
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
            data={jsonSafe(result) as object}
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

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing root element for import smoke test.');
}

createRoot(rootElement).render(<App />);
