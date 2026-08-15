import { useMemo, useRef, useState } from "react";
import {
  extractUpload,
  handleImportUploadFile,
  importProjectFromFiles,
  relayoutImport,
  type ImportProjectOptions,
} from "../lib/upload";
import {
  fileChangesForImport,
  type FileChangeRecord,
} from "../lib/file-changes";
import { MAX_SUGGESTED_SPLIT_LEVEL } from "../lib/latex-split";
import type { DiffHunk } from "../lib/diff";
import { filesForImportMode, type ImportMode } from "../lib/import-mode";
import type { DocumentKind } from "../lib/layout/document-kind";
import {
  analyzeImportSources,
  type RootCandidate,
  type UploadAnalysis,
} from "../lib/project/analyze";
import type { AttachLevel, RootAttachment } from "../lib/project/attach-roots";
import type {
  ImportedProjectResult,
  ImportedProjectSuccess,
  SourceFormat,
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
 * An upload that has been unpacked and surveyed but not yet converted. Holding
 * this lets the wizard offer source choices (format, main file, extra roots)
 * and re-run the conversion as the user changes them, without unzipping the
 * upload again each time.
 */
export interface PreparedUpload {
  fileName: string;
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
  analysis: UploadAnalysis;
}

/**
 * A pluggable conversion engine. The wizard owns the whole UI (upload, review,
 * preview, confirm) and only delegates the source → result step to the selected
 * engine, so hosts can inject their own converters (e.g. a VS Code-only pandoc
 * engine that round-trips to the extension host) without touching this package.
 *
 * An engine that implements the optional `prepare`/`convertPrepared` pair also
 * gets the source-selection step; one that only implements `convertFile` keeps
 * the original single-shot flow.
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
  /** Unpack and survey an upload without converting it. */
  prepare?: (file: File) => Promise<PreparedUpload>;
  /** Convert an already-prepared upload with the user's source choices. */
  convertPrepared?: (
    prepared: PreparedUpload,
    options: ImportProjectOptions,
  ) => ImportedProjectResult;
}

/** The default engine: the in-browser pure-TS pipeline, no external tools. */
const BUILTIN_ENGINE: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  description:
    "Create a new project starting with LaTeX, Markdown, or PreTeXt files.",
  acceptExtensions: DEFAULT_ACCEPT_EXTENSIONS,
  convertFile: handleImportUploadFile,
  prepare: async (file) => {
    const { files, assets } = await extractUpload(file);
    return {
      fileName: file.name,
      files,
      assets,
      analysis: analyzeImportSources(files),
    };
  },
  convertPrepared: (prepared, options) =>
    importProjectFromFiles(prepared.files, {
      ...options,
      assets: prepared.assets,
    }),
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
  | { name: "sources"; prepared: PreparedUpload }
  | { name: "review"; result: ImportedProjectSuccess }
  | { name: "error"; message: string };

/** How an extra root should be folded in, keyed by its path. */
type AttachChoices = Record<string, { include: boolean; level?: AttachLevel }>;

const FORMAT_LABELS: Record<SourceFormat, string> = {
  pretext: "PreTeXt",
  latex: "LaTeX",
  markdown: "Markdown",
};

/**
 * Is there a choice here worth interrupting the user for? A `project.ptx` that
 * names one target already answers the question — a stray README alongside it
 * is not a real alternative — so the step is skipped and offered from the
 * review screen instead.
 */
/** One-line explanation of why a file is offered as the document root. */
function describeCandidate(candidate: RootCandidate): string {
  const reason =
    candidate.reason === "manifest-target"
      ? `project.ptx target “${candidate.targetName}”`
      : candidate.reason === "latex-root"
        ? "LaTeX document"
        : candidate.reason === "pretext-root"
          ? "PreTeXt document"
          : candidate.reason === "markdown-root"
            ? "Markdown document"
            : "possible document";
  return candidate.title ? `${candidate.title} — ${reason}` : reason;
}

function hasSourceChoices(analysis: UploadAnalysis): boolean {
  const manifestTargets = analysis.candidates.filter(
    (candidate) => candidate.reason === "manifest-target",
  );
  if (manifestTargets.length > 1) {
    return true;
  }
  if (analysis.manifest && analysis.primary?.reason === "manifest-target") {
    return false;
  }
  return (
    analysis.formats.length > 1 ||
    analysis.candidates.length > 1 ||
    analysis.extraRoots.length > 0
  );
}

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
  // Split depth is a review-step control now: changing it re-lays-out the
  // already-converted result rather than re-running the import, so the file
  // tree can update as the user drags it.
  const [splitLevel, setSplitLevel] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState<Set<string>>(new Set());
  const [selectedEngineId, setSelectedEngineId] = useState(engineList[0].id);
  const [mode, setMode] = useState<ImportMode>("converted");
  const [showPreview, setShowPreview] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [prepared, setPrepared] = useState<PreparedUpload | null>(null);
  const [formatChoice, setFormatChoice] = useState<SourceFormat | "auto">(
    "auto",
  );
  const [mainFileChoice, setMainFileChoice] = useState<string | null>(null);
  const [attachChoices, setAttachChoices] = useState<AttachChoices>({});

  const selectedEngine =
    engineList.find((engine) => engine.id === selectedEngineId) ??
    engineList[0];
  const acceptExtensions =
    selectedEngine.acceptExtensions ?? DEFAULT_ACCEPT_EXTENSIONS;

  // Re-laying out is cheap next to a conversion (pool + serialize only), but it
  // still walks the whole division pool — and `fileChangesForImport` serializes
  // it a second time — so both are keyed to the depth rather than recomputed on
  // every render. Hoisted above the step branches because hooks may not run
  // conditionally.
  const reviewResult = step.name === "review" ? step.result : null;
  const displayedResult = useMemo(
    () =>
      reviewResult && splitLevel !== null
        ? relayoutImport(reviewResult, splitLevel)
        : reviewResult,
    [reviewResult, splitLevel],
  );
  const changesByPath = useMemo(
    () =>
      new Map<string, FileChangeRecord>(
        displayedResult
          ? fileChangesForImport(displayedResult).map((r) => [r.path, r])
          : [],
      ),
    [displayedResult],
  );

  /** The options every conversion starts from: the upload step's controls. */
  const baseOptions = (): ImportProjectOptions =>
    importOptions ?? {
      documentKind:
        documentKindChoice === "auto" ? undefined : documentKindChoice,
    };

  /** Re-survey the upload under the user's current format/main-file choices. */
  const currentAnalysis = (upload: PreparedUpload): UploadAnalysis =>
    analyzeImportSources(upload.files, {
      sourceFormat: formatChoice === "auto" ? undefined : formatChoice,
      mainFile: mainFileChoice ?? undefined,
    });

  const runImport = (upload: PreparedUpload) => {
    setStep({ name: "processing" });
    try {
      const analysis = currentAnalysis(upload);
      const attachRoots: RootAttachment[] = analysis.extraRoots.map((root) => ({
        path: root.path,
        include: attachChoices[root.path]?.include ?? true,
        level: attachChoices[root.path]?.level,
      }));
      const result = selectedEngine.convertPrepared!(upload, {
        ...baseOptions(),
        sourceFormat: formatChoice === "auto" ? undefined : formatChoice,
        mainFile: mainFileChoice ?? undefined,
        attachRoots,
      });
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

  const processFile = async (file: File) => {
    setStep({ name: "processing" });
    try {
      // Two-phase engines unpack first, so the user can settle which file is
      // the document before anything is converted. Single-shot engines (a
      // host-provided pandoc bridge, say) keep the original flow.
      if (selectedEngine.prepare && selectedEngine.convertPrepared) {
        const upload = await selectedEngine.prepare(file);
        setPrepared(upload);
        setFormatChoice("auto");
        setMainFileChoice(null);
        setAttachChoices({});
        if (hasSourceChoices(upload.analysis)) {
          setStep({ name: "sources", prepared: upload });
          return;
        }
        const result = selectedEngine.convertPrepared(upload, baseOptions());
        setStep(
          "pretextError" in result
            ? { name: "error", message: result.pretextError }
            : { name: "review", result },
        );
        return;
      }

      const result = await selectedEngine.convertFile(file, baseOptions());
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
    setShowDiff(new Set());
    setSplitLevel(null);
    setPrepared(null);
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
    const mainPath =
      m === "converted"
        ? result.projectLayout.mainSourcePath
        : result.sourcePath;
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

  if (step.name === "sources") {
    const upload = step.prepared;
    const analysis = currentAnalysis(upload);
    const manifest = analysis.manifest;
    const chosenPath = analysis.primary?.path ?? "";

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">
            Choose what to import
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {upload.fileName} contains more than one possible starting point.
          </p>
        </div>

        {manifest ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-medium">
              Found {manifest.manifestPath} — an existing PreTeXt project.
            </p>
            <p className="mt-1 text-blue-800">
              Its publication file, assets, and directory layout will be kept as
              they are. Targets:{" "}
              {manifest.targets.map((target) => target.name).join(", ")}.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-700">
            <span className="text-slate-500">Source format</span>
            <select
              value={formatChoice}
              onChange={(e) => {
                setFormatChoice(e.currentTarget.value as SourceFormat | "auto");
                // Candidates are format-scoped; a stale pick would silently
                // override the new format.
                setMainFileChoice(null);
                setAttachChoices({});
              }}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="auto">
                Auto detect
                {analysis.primary
                  ? ` (${FORMAT_LABELS[analysis.primary.format]})`
                  : ""}
              </option>
              {analysis.formats.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {analysis.candidates.length > 1 ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Main document
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              {analysis.candidates.map((candidate) => (
                <label
                  key={candidate.path}
                  className="flex cursor-pointer items-start gap-3 text-sm"
                >
                  <input
                    type="radio"
                    name="main-file"
                    value={candidate.path}
                    checked={chosenPath === candidate.path}
                    onChange={() => {
                      setMainFileChoice(candidate.path);
                      setAttachChoices({});
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-xs text-slate-900">
                      {candidate.path}
                    </span>
                    <span className="block text-slate-500">
                      {describeCandidate(candidate)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {analysis.extraRoots.length > 0 ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Other documents
            </legend>
            <p className="mt-1 text-sm text-slate-500">
              These files also stand on their own. Attach them to the main
              document, or leave them out.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {analysis.extraRoots.map((root) => {
                const choice = attachChoices[root.path];
                const included = choice?.include ?? true;
                return (
                  <div
                    key={root.path}
                    className="flex flex-wrap items-center gap-3 text-sm"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(e) =>
                          setAttachChoices((prev) => ({
                            ...prev,
                            [root.path]: {
                              ...prev[root.path],
                              include: e.currentTarget.checked,
                            },
                          }))
                        }
                      />
                      <span className="font-mono text-xs text-slate-900">
                        {root.path}
                      </span>
                      {root.title ? (
                        <span className="text-slate-500">— {root.title}</span>
                      ) : null}
                    </label>
                    <label className="flex items-center gap-2 text-slate-700">
                      <span className="text-slate-500">Attach as</span>
                      <select
                        value={choice?.level ?? "auto"}
                        disabled={!included}
                        onChange={(e) =>
                          setAttachChoices((prev) => ({
                            ...prev,
                            [root.path]: {
                              include: prev[root.path]?.include ?? true,
                              level:
                                e.currentTarget.value === "auto"
                                  ? undefined
                                  : (e.currentTarget.value as AttachLevel),
                            },
                          }))
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                      >
                        <option value="auto">Auto</option>
                        <option value="chapter">Chapter</option>
                        <option value="section">Section</option>
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={restart}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Start Over
          </button>
          <button
            type="button"
            onClick={() => runImport(upload)}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step.name === "review") {
    const result = displayedResult ?? step.result;
    const currentLevel = result.splitLevel;
    const isLatex = result.detectedSourceFormat === "latex";
    const warningCount = result.warnings.length;
    const fileCount = Object.keys(result.outputFiles).length;

    const currentPreviewFiles = filesForImportMode(result, mode);
    const mainPath =
      mode === "converted"
        ? result.projectLayout.mainSourcePath
        : result.sourcePath;
    const sortedPreviewPaths = sortPaths(
      Object.keys(currentPreviewFiles),
      mainPath,
    );

    function handleModeChange(newMode: ImportMode) {
      setMode(newMode);
      if (showPreview) openFirstFile(result, newMode);
    }

    function toggleDiff(path: string) {
      setShowDiff((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
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
            {result.projectLayout.preserved ? (
              <>
                <dt className="text-slate-500">Existing project</dt>
                <dd className="font-medium text-slate-900">
                  Kept publication file, assets, and layout
                </dd>
              </>
            ) : null}
            {result.attachedRoots.length > 0 ? (
              <>
                <dt className="text-slate-500">Attached</dt>
                <dd className="font-medium text-slate-900">
                  {result.attachedRoots
                    .map((root) => `${root.title} (${root.level})`)
                    .join(", ")}
                </dd>
              </>
            ) : null}
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

        {!importOptions && result.cleanChunks.length > 0 ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Split into files
            </legend>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {Array.from(
                { length: MAX_SUGGESTED_SPLIT_LEVEL + 1 },
                (_, level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSplitLevel(level)}
                    aria-pressed={currentLevel === level}
                    className={
                      currentLevel === level
                        ? "rounded bg-blue-700 px-3 py-1 text-sm font-medium text-white"
                        : "rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                    }
                  >
                    {level === 0
                      ? "One file"
                      : `${level} level${level === 1 ? "" : "s"}`}
                  </button>
                ),
              )}
              <span className="ml-2 text-sm text-slate-500">
                {sortedPreviewPaths.length} file
                {sortedPreviewPaths.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-3 max-h-48 overflow-auto font-mono text-xs text-slate-600">
              {sortedPreviewPaths.map((path) => (
                <li key={path} className="truncate py-0.5">
                  {path}
                  {changesByPath.get(path)?.fixCount ? (
                    <span className="ml-2 text-amber-700">
                      {changesByPath.get(path)!.fixCount} change
                      {changesByPath.get(path)!.fixCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
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
                    <div className="bg-white">
                      {changesByPath.get(path)?.hunks.length ? (
                        <div className="flex gap-2 border-b border-slate-200 px-4 py-2">
                          <button
                            type="button"
                            onClick={() => toggleDiff(path)}
                            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            {showDiff.has(path)
                              ? "Show converted file"
                              : "Show what changed"}
                          </button>
                          <span className="text-xs text-slate-500">
                            +{changesByPath.get(path)!.stats.added} −
                            {changesByPath.get(path)!.stats.removed} in the
                            LaTeX source
                          </span>
                        </div>
                      ) : null}
                      {showDiff.has(path) && changesByPath.has(path) ? (
                        <DiffView hunks={changesByPath.get(path)!.hunks} />
                      ) : (
                        <pre className="m-0 max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-800">
                          {currentPreviewFiles[path]}
                        </pre>
                      )}
                    </div>
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
            {prepared ? (
              <button
                type="button"
                onClick={() => setStep({ name: "sources", prepared })}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Change Sources
              </button>
            ) : null}
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

/**
 * A unified before/after view of what cleaning did to one file's LaTeX source.
 *
 * Hunks, not whole files: a cleaning pass touches a handful of scattered lines,
 * so the untouched runs between them are elided rather than scrolled past.
 */
function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  if (hunks.length === 0) {
    return (
      <p className="m-0 px-4 py-3 text-xs text-slate-500">
        Nothing was changed in this file.
      </p>
    );
  }

  return (
    <div className="max-h-72 overflow-auto bg-white font-mono text-xs leading-relaxed">
      {hunks.map((hunk, index) => (
        <div key={index} className="border-b border-slate-100 last:border-b-0">
          {index > 0 ? (
            <div className="bg-slate-50 px-4 py-1 text-slate-400">⋯</div>
          ) : null}
          {hunk.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={
                line.op === "add"
                  ? "bg-green-50 px-4 text-green-900"
                  : line.op === "remove"
                    ? "bg-red-50 px-4 text-red-900"
                    : "px-4 text-slate-600"
              }
            >
              <span className="mr-2 select-none text-slate-400">
                {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
              </span>
              {line.text || " "}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
