import { useRef, useState } from "react";
import {
  handleImportUploadFile,
  type ImportProjectOptions,
} from "../lib/upload";
import { filesForImportMode, type ImportMode } from "../lib/import-mode";
import type { DocumentKind } from "../lib/layout/document-kind";
import type {
  ImportedProjectResult,
  ImportedProjectSuccess,
} from "../lib/types";

export type { ImportMode };

/** File extensions accepted by the built-in converter. */
const DEFAULT_ACCEPT_EXTENSIONS = [
  ".tex",
  ".md",
  ".markdown",
  ".ptx",
  ".xml",
  ".zip",
  ".gz",
  ".tar.gz",
  ".tgz",
];

/**
 * A pluggable conversion engine. The wizard owns the whole UI (upload, review,
 * preview, confirm) and only delegates the source → result step to the selected
 * engine, so hosts can inject their own converters (e.g. a VS Code-only pandoc
 * engine that round-trips to the extension host) without touching this package.
 */
export interface ImportEngine {
  /** Stable identifier, used as the radio value. */
  id: string;
  /** Short name shown in the engine selector. */
  label: string;
  /** Optional one-line explanation shown under the label. */
  description?: string;
  /** Extensions this engine accepts (with leading dot). Defaults to the built-in set. */
  acceptExtensions?: string[];
  /** Convert an uploaded file into an import result. */
  convertFile: (
    file: File,
    options: ImportProjectOptions,
  ) => Promise<ImportedProjectResult>;
}

/** The default engine: the in-browser pure-TS pipeline, no external tools. */
const BUILTIN_ENGINE: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  description: "Create a new project starting with LaTeX, Markdown, or PreTeXt files.",
  acceptExtensions: DEFAULT_ACCEPT_EXTENSIONS,
  convertFile: handleImportUploadFile,
};

export interface ImportWizardProps {
  /** Called when the user confirms the import. */
  onConfirm: (result: ImportedProjectSuccess, mode: ImportMode) => void;
  /** Called when the user cancels at the review step. */
  onCancel?: () => void;
  /** Pass fixed options to skip the document-kind / split-sections controls. */
  importOptions?: ImportProjectOptions;
  defaultDocumentKind?: DocumentKind | "auto";
  /**
   * Converters offered to the user. When more than one is supplied, an engine
   * selector is shown on the upload step. Defaults to a single built-in engine.
   */
  engines?: ImportEngine[];
}

type Step =
  | { name: "upload" }
  | { name: "processing" }
  | { name: "review"; result: ImportedProjectSuccess }
  | { name: "error"; message: string };

export function ImportWizard({
  onConfirm,
  onCancel,
  importOptions,
  defaultDocumentKind = "auto",
  engines,
}: ImportWizardProps) {
  const engineList = engines && engines.length > 0 ? engines : [BUILTIN_ENGINE];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<Step>({ name: "upload" });
  const [dragActive, setDragActive] = useState(false);
  const [documentKindChoice, setDocumentKindChoice] = useState<
    DocumentKind | "auto"
  >(defaultDocumentKind);
  const [splitSections, setSplitSections] = useState(false);
  const [selectedEngineId, setSelectedEngineId] = useState(engineList[0].id);
  const [mode, setMode] = useState<ImportMode>("converted");
  const [showPreview, setShowPreview] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const selectedEngine =
    engineList.find((engine) => engine.id === selectedEngineId) ??
    engineList[0];
  const acceptExtensions =
    selectedEngine.acceptExtensions ?? DEFAULT_ACCEPT_EXTENSIONS;

  const processFile = async (file: File) => {
    setStep({ name: "processing" });
    try {
      const options: ImportProjectOptions = importOptions ?? {
        documentKind:
          documentKindChoice === "auto" ? undefined : documentKindChoice,
        splitSections,
      };
      const result = await selectedEngine.convertFile(file, options);
      if ("pretextError" in result) {
        setStep({ name: "error", message: result.pretextError });
      } else {
        setStep({ name: "review", result });
      }
    } catch (err) {
      setStep({
        name: "error",
        message:
          err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    }
  };

  const restart = () => {
    setStep({ name: "upload" });
    setMode("converted");
    setShowPreview(false);
    setExpandedFiles(new Set());
  };

  function sortPaths(paths: string[], mainPath: string): string[] {
    return [...paths].sort((a, b) => {
      if (a === mainPath) return -1;
      if (b === mainPath) return 1;
      return a.localeCompare(b);
    });
  }

  function openFirstFile(result: ImportedProjectSuccess, m: ImportMode) {
    const files = filesForImportMode(result, m);
    const mainPath = m === "converted" ? "source/main.ptx" : result.sourcePath;
    const first = sortPaths(Object.keys(files), mainPath)[0];
    setExpandedFiles(first ? new Set([first]) : new Set());
  }

  function toggleExpanded(path: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (step.name === "processing") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-600">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
        <p className="text-sm">Processing your file…</p>
      </div>
    );
  }

  if (step.name === "error") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Import failed</p>
          <p className="mt-1">{step.message}</p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={restart}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Try Another File
          </button>
        </div>
      </div>
    );
  }

  if (step.name === "review") {
    const { result } = step;
    const isLatex = result.detectedSourceFormat === "latex";
    const warningCount = result.warnings.length;
    const fileCount = Object.keys(result.outputFiles).length;

    const currentPreviewFiles = filesForImportMode(result, mode);
    const mainPath =
      mode === "converted" ? "source/main.ptx" : result.sourcePath;
    const sortedPreviewPaths = sortPaths(
      Object.keys(currentPreviewFiles),
      mainPath,
    );

    function handleModeChange(newMode: ImportMode) {
      setMode(newMode);
      if (showPreview) openFirstFile(result, newMode);
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Import Summary
          </h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">Source</dt>
            <dd className="font-medium text-slate-900">{result.sourceName}</dd>
            <dt className="text-slate-500">Detected format</dt>
            <dd className="font-medium text-slate-900 capitalize">
              {result.detectedSourceFormat}
            </dd>
            <dt className="text-slate-500">Document kind</dt>
            <dd className="font-medium text-slate-900 capitalize">
              {result.documentKind}
            </dd>
            <dt className="text-slate-500">Output files</dt>
            <dd className="font-medium text-slate-900">{fileCount}</dd>
          </dl>
        </div>

        {warningCount > 0 ? (
          <details className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-amber-800">
              {warningCount} conversion{" "}
              {warningCount === 1 ? "warning" : "warnings"}
            </summary>
            <ul className="mt-3 space-y-1.5 text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
                    {w.macro}
                  </code>
                  {" — "}
                  {w.action === "replace" || w.action === "rewrite"
                    ? `replaced with \`${w.replacement}\``
                    : (w.message ?? w.action)}
                  {w.occurrences > 1 ? ` (×${w.occurrences})` : null}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-sm text-green-700">No conversion warnings.</p>
        )}

        {isLatex ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Import mode
            </legend>
            <div className="mt-2 flex flex-col gap-3">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  value="converted"
                  checked={mode === "converted"}
                  onChange={() => handleModeChange("converted")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900">
                    Convert to PreTeXt
                  </span>
                  <span className="block text-slate-500">
                    Use the converted PreTeXt output. Recommended for new
                    PreTeXt projects.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  value="native"
                  checked={mode === "native"}
                  onChange={() => handleModeChange("native")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900">
                    Keep as LaTeX
                  </span>
                  <span className="block text-slate-500">
                    Preserve the original LaTeX source. The conversion will not
                    be applied.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        ) : null}

        {showPreview ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 text-sm">
            {sortedPreviewPaths.map((path) => {
              const isOpen = expandedFiles.has(path);
              return (
                <div
                  key={path}
                  className="border-b border-slate-200 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(path)}
                    className="flex w-full items-center gap-2 bg-slate-100 px-4 py-2 text-left font-mono text-xs text-slate-700 hover:bg-slate-200"
                  >
                    <span className="shrink-0 text-slate-400">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="flex-1 truncate">{path}</span>
                    <span className="shrink-0 text-slate-400">
                      {(currentPreviewFiles[path].length / 1024).toFixed(1)} KB
                    </span>
                  </button>
                  {isOpen ? (
                    <pre className="m-0 max-h-72 overflow-auto bg-white p-4 font-mono text-xs leading-relaxed text-slate-800">
                      {currentPreviewFiles[path]}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel ?? restart}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            {onCancel ? "Cancel" : "Start Over"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!showPreview) openFirstFile(result, mode);
                setShowPreview((v) => !v);
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {showPreview ? "Hide Preview" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(result, mode)}
              className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              Confirm Import
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="flex flex-col gap-4">
      {engineList.length > 1 ? (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">
            Converter
          </legend>
          <div className="mt-2 flex flex-col gap-3">
            {engineList.map((engine) => (
              <label
                key={engine.id}
                className="flex cursor-pointer items-start gap-3 text-sm"
              >
                <input
                  type="radio"
                  name="import-engine"
                  value={engine.id}
                  checked={selectedEngineId === engine.id}
                  onChange={() => setSelectedEngineId(engine.id)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900">
                    {engine.label}
                  </span>
                  {engine.description ? (
                    <span className="block text-slate-500">
                      {engine.description}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {!importOptions ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-700">
            <span className="text-slate-500">Document kind</span>
            <select
              value={documentKindChoice}
              onChange={(e) =>
                setDocumentKindChoice(
                  e.currentTarget.value as DocumentKind | "auto",
                )
              }
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="auto">Auto detect</option>
              <option value="article">Article</option>
              <option value="book">Book</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={splitSections}
              onChange={(e) => setSplitSections(e.currentTarget.checked)}
            />
            Split sections into separate files
          </label>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void processFile(file);
        }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-slate-400"
        }`}
      >
        <p className="text-slate-600">Drop a file here, or click to select.</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Select File
        </button>
        <p className="text-xs text-slate-400">
          Supports {acceptExtensions.join(", ")}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={acceptExtensions.join(",")}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void processFile(file);
            e.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}
