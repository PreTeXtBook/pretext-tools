import { useMemo, useRef, useState } from "react";
import {
  extractUpload,
  handleImportUploadFile,
  importProjectFromFiles,
  rebuildImport,
  type ImportProjectOptions,
} from "../lib/upload";
import {
  DIVISION_LADDER,
  type PretextDivisionTag,
} from "../lib/pretext-divisions";
import {
  outlineDivisions,
  type DivisionOutlineItem,
  type DivisionPath,
} from "../lib/select/divisions";
import {
  fileChangesForImport,
  type FileChangeRecord,
} from "../lib/file-changes";
import { MAX_SUGGESTED_SPLIT_LEVEL } from "../lib/latex-split";
import type { DiffHunk } from "../lib/diff";
import {
  DEFAULT_IMPORT_MODE,
  filesForImportMode,
  hasNativeImportMode,
  resolveImportMode,
  type ImportMode,
} from "../lib/import-mode";
import { ProcessingPanel } from "./processing-panel";
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

import {
  DEFAULT_ACCEPT_EXTENSIONS,
  allAcceptExtensions,
  alternateFor,
  routeEngine,
  unsupportedFileMessage,
} from "../lib/engine-routing";

export type { ImportMode };

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
 *
 * Engines are never chosen by hand: the wizard routes each upload by its
 * extension, in list order, so list the engine that should own a shared format
 * first (see `lib/engine-routing.ts`). `label` and `description` surface only
 * in the opt-in checkbox for an engine that overlaps an earlier one, and in
 * error messages — so word them for that, not as a menu entry.
 */
export interface ImportEngine {
  /** Stable identifier. */
  id: string;
  /** Short name, used in the opt-in checkbox and in error messages. */
  label: string;
  /** Optional one-line explanation shown under the opt-in checkbox. */
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
  /**
   * Convert an already-prepared upload with the user's source choices.
   *
   * May return synchronously (the built-in engine does) or a promise (the
   * worker engine does). The wizard always awaits, which is what lets the
   * processing screen paint and its timer tick before the work starts.
   */
  convertPrepared?: (
    prepared: PreparedUpload,
    options: ImportProjectOptions,
  ) => ImportedProjectResult | Promise<ImportedProjectResult>;
  /**
   * Stop an in-flight conversion. Engines that run the pipeline in-process
   * cannot honour this — the pipeline has no yield points — so only the worker
   * engine supplies it, and the processing screen shows Cancel only when it is
   * present.
   */
  cancel?: () => void;
}

/** The default engine: the in-browser pure-TS pipeline, no external tools. */
const BUILTIN_ENGINE: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  description: "Converts LaTeX, Markdown, and PreTeXt without any other tools.",
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

/**
 * Resolve after the browser has painted.
 *
 * Needed because an engine may convert synchronously (the built-in one does),
 * and `await` on a non-promise only queues a microtask — which drains *before*
 * paint, while React schedules its render as a macrotask. Without a real frame
 * boundary the processing screen would never reach the screen before a sync
 * engine seized the thread. `requestAnimationFrame` runs before the paint, so a
 * timeout scheduled from inside it resumes after it.
 *
 * Costs one frame (~16ms) against a multi-second conversion. Falls back to a
 * bare timeout where there is no rAF (tests, SSR).
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

export interface ImportWizardProps {
  /**
   * Called when the user confirms the import. May return a promise — writing
   * the file map out is the host's slow step (VS Code writes to disk,
   * pretext-plus uploads), so the wizard awaits it and holds the button in a
   * pending state until it settles rather than appearing to do nothing.
   */
  onConfirm: (
    result: ImportedProjectSuccess,
    mode: ImportMode,
  ) => void | Promise<void>;
  /** Called when the user cancels at the review step. */
  onCancel?: () => void;
  /** Pass fixed options to skip the document-kind / split-sections controls. */
  importOptions?: ImportProjectOptions;
  defaultDocumentKind?: DocumentKind | "auto";
  /**
   * Which import style the review step starts on: `"converted"` (the PreTeXt
   * output) or `"native"` (the cleaned LaTeX/Markdown source, unconverted).
   * The user can still switch, unless `lockImportMode` is set. Ignored for
   * results with no native alternative — a PreTeXt upload always reviews as
   * converted.
   */
  defaultImportMode?: ImportMode;
  /**
   * Hide the import-mode chooser and import in `defaultImportMode` only. For
   * hosts that support just one style, or that already asked elsewhere.
   */
  lockImportMode?: boolean;
  /** Called when the user picks a different import mode on the review step. */
  onImportModeChange?: (mode: ImportMode) => void;
  /**
   * Converters offered to the user. When more than one is supplied, an engine
   * selector is shown on the upload step. Defaults to a single built-in engine.
   */
  engines?: ImportEngine[];
  /**
   * Import into a document that already exists rather than creating a project
   * (SPEC §9). Only the host knows where the cursor is and what the project
   * already contains, so it supplies both; the wizard adds the control that
   * lets the author move the attach level and see the result before confirming.
   */
  insertTarget?: InsertTargetOffer;
}

/** What the host knows about the document an import is being inserted into. */
export interface InsertTargetOffer {
  /** How to name that document to the author, e.g. `ch-intro.ptx`. */
  documentLabel: string;
  /** The level derived from the cursor; the control starts here. */
  defaultTargetTag: PretextDivisionTag;
  /** Levels on offer, outermost first. Defaults to the whole division ladder. */
  targetTags?: PretextDivisionTag[];
  /**
   * Every `xml:id` live in the host project. An array rather than a `Set`
   * because this crosses a webview `postMessage` boundary.
   */
  takenIds: string[];
  /** Directory of the file receiving the include, with a trailing slash. */
  hrefBase: string;
  /**
   * The host project's `<directories external="…"/>`, so imported images land
   * where that project keeps its own rather than in this package's default.
   */
  externalDir?: string;
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
  defaultImportMode = DEFAULT_IMPORT_MODE,
  lockImportMode = false,
  onImportModeChange,
  engines,
  insertTarget,
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
  // The attach level is a review-step control for the same reason the split
  // depth is: changing it rebuilds the already-converted result rather than
  // re-running the import, so the file tree updates as the author tries levels.
  const [targetTag, setTargetTag] = useState<PretextDivisionTag | null>(null);
  // Which divisions to import (SPEC §9, step 6). Empty means the whole
  // document, which is both the default and what "Select all" restores.
  const [selection, setSelection] = useState<DivisionPath[]>([]);
  const [showDiff, setShowDiff] = useState<Set<string>>(new Set());
  // Which engine converted (or is converting) the current upload. Set by
  // `processFile` from the file's own extension — never by the author — and
  // kept so the sources step and the Cancel button address the right engine.
  const [activeEngineId, setActiveEngineId] = useState(engineList[0].id);
  // The file itself, kept so the review step can put it back through the other
  // converter without making the author find and drop it a second time.
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>(defaultImportMode);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [prepared, setPrepared] = useState<PreparedUpload | null>(null);
  const [formatChoice, setFormatChoice] = useState<SourceFormat | "auto">(
    "auto",
  );
  const [mainFileChoice, setMainFileChoice] = useState<string | null>(null);
  const [attachChoices, setAttachChoices] = useState<AttachChoices>({});
  const [confirming, setConfirming] = useState(false);
  // Set when the user cancels, so the conversion's own rejection (a terminated
  // worker) is swallowed instead of surfacing as an import failure.
  const cancelledRef = useRef(false);

  const activeEngine =
    engineList.find((engine) => engine.id === activeEngineId) ?? engineList[0];
  // One picker for every format the host can import; the extension decides
  // which engine gets the file.
  const acceptExtensions = allAcceptExtensions(engineList);

  // The override, offered only once there is a file to describe it: the other
  // converter that can read *this* upload, and whether it is the one that
  // produced the result on screen. Both are undefined for a format only one
  // converter reads, which is what keeps the choice off the upload step.
  const alternate = sourceFile
    ? alternateFor(engineList, sourceFile.name)
    : undefined;
  const usingAlternate = alternate ? activeEngine.id === alternate.id : false;
  /** The converter the override would switch this upload to. */
  const switchTarget = alternate
    ? usingAlternate
      ? (routeEngine(engineList, sourceFile!.name) ?? null)
      : alternate
    : null;

  // Re-laying out is cheap next to a conversion (pool + serialize only), but it
  // still walks the whole division pool — and `fileChangesForImport` serializes
  // it a second time — so both are keyed to the depth rather than recomputed on
  // every render. Hoisted above the step branches because hooks may not run
  // conditionally.
  const reviewResult = step.name === "review" ? step.result : null;
  const displayedResult = useMemo(
    () =>
      reviewResult &&
      (splitLevel !== null || targetTag !== null || selection.length > 0)
        ? rebuildImport(reviewResult, {
            splitLevel: splitLevel ?? undefined,
            targetTag: targetTag ?? undefined,
            selection,
          })
        : reviewResult,
    [reviewResult, splitLevel, targetTag, selection],
  );

  // The picker is built from the raw conversion, so the divisions an author
  // deselected are still there to select back — a picker that only listed what
  // survived the last prune would be a one-way door.
  const divisionOutline = useMemo(
    () => (reviewResult ? outlineDivisions(reviewResult.pretextSource) : []),
    [reviewResult],
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

  /**
   * Where the import is going. Built once per render from the host's offer, so
   * the conversion and every rebuild agree on the same `takenIds`.
   */
  const destination = useMemo(
    (): ImportProjectOptions["destination"] =>
      insertTarget
        ? {
            kind: "insert",
            targetTag: targetTag ?? insertTarget.defaultTargetTag,
            takenIds: new Set(insertTarget.takenIds),
            hrefBase: insertTarget.hrefBase,
          }
        : undefined,
    [insertTarget, targetTag],
  );

  /** The options every conversion starts from: the upload step's controls. */
  const baseOptions = (): ImportProjectOptions => ({
    ...(importOptions ?? {
      documentKind:
        documentKindChoice === "auto" ? undefined : documentKindChoice,
    }),
    ...(destination ? { destination } : {}),
    ...(insertTarget?.externalDir
      ? { externalDir: insertTarget.externalDir }
      : {}),
  });

  /** Re-survey the upload under the user's current format/main-file choices. */
  const currentAnalysis = (upload: PreparedUpload): UploadAnalysis =>
    analyzeImportSources(upload.files, {
      sourceFormat: formatChoice === "auto" ? undefined : formatChoice,
      mainFile: mainFileChoice ?? undefined,
    });

  /**
   * Abandon the conversion in flight and go back where the user came from.
   * Only offered when the engine can actually stop (the worker engine); an
   * in-process engine has no yield point at which to notice.
   */
  const cancelProcessing = (upload: PreparedUpload | null) => {
    cancelledRef.current = true;
    activeEngine.cancel?.();
    setStep(
      upload ? { name: "sources", prepared: upload } : { name: "upload" },
    );
  };

  const runImport = async (upload: PreparedUpload) => {
    cancelledRef.current = false;
    setStep({ name: "processing" });
    await nextPaint();
    try {
      const analysis = currentAnalysis(upload);
      const attachRoots: RootAttachment[] = analysis.extraRoots.map((root) => ({
        path: root.path,
        include: attachChoices[root.path]?.include ?? true,
        level: attachChoices[root.path]?.level,
      }));
      // Awaited even when the engine is synchronous: the await yields to the
      // event loop, which is what lets React commit the processing step and
      // the browser paint it before a sync engine seizes the thread.
      const result = await activeEngine.convertPrepared!(upload, {
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
      if (cancelledRef.current) {
        return;
      }
      setStep({
        name: "error",
        message:
          err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    }
  };

  /**
   * Convert an upload.
   *
   * The file picks the converter by its own extension; `engineOverride` is the
   * review step handing the same file to the other one. Either way this is a
   * conversion from scratch, so whatever the last one accumulated — a split
   * depth, a division selection — is dropped rather than re-applied to a
   * document it was never chosen for.
   */
  const processFile = async (file: File, engineOverride?: ImportEngine) => {
    const engine = engineOverride ?? routeEngine(engineList, file.name);
    if (!engine) {
      setSourceFile(file);
      setStep({
        name: "error",
        message: unsupportedFileMessage(file.name, engineList),
      });
      return;
    }
    setSourceFile(file);
    setActiveEngineId(engine.id);
    resetReviewState();

    cancelledRef.current = false;
    setStep({ name: "processing" });
    await nextPaint();
    try {
      // Two-phase engines unpack first, so the user can settle which file is
      // the document before anything is converted. Single-shot engines (a
      // host-provided pandoc bridge, say) keep the original flow.
      if (engine.prepare && engine.convertPrepared) {
        const upload = await engine.prepare(file);
        setPrepared(upload);
        setFormatChoice("auto");
        setMainFileChoice(null);
        setAttachChoices({});
        if (hasSourceChoices(upload.analysis)) {
          setStep({ name: "sources", prepared: upload });
          return;
        }
        await nextPaint();
        const result = await engine.convertPrepared(upload, baseOptions());
        setStep(
          "pretextError" in result
            ? { name: "error", message: result.pretextError }
            : { name: "review", result },
        );
        return;
      }

      // A single-shot engine unpacks nothing, so any survey left over from a
      // two-phase conversion of this same file describes a run that no longer
      // exists — and Cancel would return to its stale sources step.
      setPrepared(null);
      const result = await engine.convertFile(file, baseOptions());
      if ("pretextError" in result) {
        setStep({ name: "error", message: result.pretextError });
      } else {
        setStep({ name: "review", result });
      }
    } catch (err) {
      if (cancelledRef.current) {
        return;
      }
      setStep({
        name: "error",
        message:
          err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    }
  };

  /** Drop everything the review step accumulated about one conversion. */
  const resetReviewState = () => {
    setMode(defaultImportMode);
    setShowPreview(false);
    setExpandedFiles(new Set());
    setShowDiff(new Set());
    setSplitLevel(null);
    setTargetTag(null);
    setSelection([]);
  };

  const restart = () => {
    setStep({ name: "upload" });
    resetReviewState();
    setPrepared(null);
    setSourceFile(null);
  };

  /** Put the current upload through the other converter. */
  const switchConverter = () => {
    if (sourceFile && switchTarget) {
      void processFile(sourceFile, switchTarget);
    }
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
      <ProcessingPanel
        onCancel={
          activeEngine.cancel ? () => cancelProcessing(prepared) : undefined
        }
      />
    );
  }

  if (step.name === "error") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Import failed</p>
          <p className="mt-1">{step.message}</p>
        </div>
        <div className="flex justify-end gap-2">
          {switchTarget ? (
            <button
              type="button"
              onClick={switchConverter}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Try {switchTarget.label} Instead
            </button>
          ) : null}
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
    // The mode that will actually be applied: a preferred "native" collapses
    // to "converted" when this result has no native alternative (PreTeXt
    // input), so the preview, the confirm payload, and the radios all agree.
    // Cherry-picking prunes the *converted* document; the native projection is
    // built from the cleaned LaTeX or Markdown, which the prune never saw. So a
    // selection and native mode cannot both be honoured, and the selection —
    // which the author expressed explicitly — wins.
    const selectionActive = selection.length > 0;
    const nativeAvailable = hasNativeImportMode(result) && !selectionActive;
    const effectiveMode = nativeAvailable
      ? resolveImportMode(result, mode)
      : "converted";
    const nativeFormatLabel =
      result.detectedSourceFormat === "markdown" ? "Markdown" : "LaTeX";
    const warningCount = result.warnings.length;
    const fileCount = Object.keys(result.outputFiles).length;
    const insertRecord = result.insert;
    const currentTargetTag =
      result.destination.kind === "insert"
        ? result.destination.targetTag
        : undefined;
    const offeredTargetTags = insertTarget?.targetTags ?? [...DIVISION_LADDER];

    const currentPreviewFiles = filesForImportMode(result, effectiveMode);
    const mainPath =
      effectiveMode === "converted"
        ? result.projectLayout.mainSourcePath
        : result.sourcePath;
    const sortedPreviewPaths = sortPaths(
      Object.keys(currentPreviewFiles),
      mainPath,
    );

    function handleModeChange(newMode: ImportMode) {
      setMode(newMode);
      onImportModeChange?.(newMode);
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
            {insertTarget ? (
              <>
                <dt className="text-slate-500">Destination</dt>
                <dd className="font-medium text-slate-900">
                  Inserted into {insertTarget.documentLabel}
                </dd>
              </>
            ) : null}
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

        {/*
          The converter override, and the only place it appears. Which
          converter can read a file is a fact about the file, so the wizard
          settles it silently; which converter did *better* is a judgement
          about the output, which is exactly what this screen shows. Offered
          only when this upload has a second converter that could read it —
          for a Word file or a zipped project there is nothing to switch to.
        */}
        {alternate ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm">
            <input
              type="checkbox"
              checked={usingAlternate}
              onChange={switchConverter}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-900">
                Convert with {alternate.label} instead
              </span>
              <span className="block text-slate-500">
                {alternate.description ??
                  `Runs ${result.sourceName} through ${alternate.label} and rebuilds this preview.`}
              </span>
            </span>
          </label>
        ) : null}

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

        {nativeAvailable && !lockImportMode ? (
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
                  checked={effectiveMode === "converted"}
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
                  checked={effectiveMode === "native"}
                  onChange={() => handleModeChange("native")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900">
                    Keep as {nativeFormatLabel}
                  </span>
                  <span className="block text-slate-500">
                    Preserve the original {nativeFormatLabel} source. The
                    conversion will not be applied.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        ) : null}

        {divisionOutline.length > 1 ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Divisions to import
            </legend>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setSelection([])}
                className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50"
              >
                Everything
              </button>
              <span className="text-slate-500">
                {selection.length === 0
                  ? "The whole document"
                  : `${selection.length} of ${countDivisions(divisionOutline)} divisions`}
              </span>
            </div>
            <div className="mt-3 max-h-56 overflow-auto">
              <DivisionPicker
                items={divisionOutline}
                selection={selection}
                onToggle={(path) =>
                  setSelection((prev) =>
                    prev.includes(path)
                      ? prev.filter((p) => p !== path)
                      : [...prev, path].sort(comparePaths),
                  )
                }
              />
            </div>
            {selection.length > 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                A selected division is imported whole, with everything inside
                it. Divisions above one you selected are kept as structure.
                {hasNativeImportMode(step.result)
                  ? " Selecting divisions imports the converted PreTeXt; keeping the original source imports the document whole."
                  : ""}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {insertRecord && insertTarget ? (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              Attach to {insertTarget.documentLabel}
            </legend>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {offeredTargetTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTargetTag(tag)}
                  aria-pressed={currentTargetTag === tag}
                  className={
                    currentTargetTag === tag
                      ? "rounded bg-blue-700 px-3 py-1 text-sm font-medium text-white"
                      : "rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  }
                >
                  &lt;{tag}&gt;
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {insertRecord.includes.length === 1
                ? `One <${currentTargetTag}> is added to ${insertTarget.documentLabel}, `
                : `${insertRecord.includes.length} <${currentTargetTag}> divisions are added to ${insertTarget.documentLabel}, `}
              {insertRecord.includes.length === 1
                ? "included from a new file beside it."
                : "each included from a new file beside it."}
            </p>
            {insertRecord.renamed.length > 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                {insertRecord.renamed.length} id
                {insertRecord.renamed.length === 1 ? "" : "s"} already used in
                this project{" "}
                {insertRecord.renamed.length === 1 ? "was" : "were"} renamed:{" "}
                <span className="font-mono text-xs">
                  {insertRecord.renamed
                    .map((rename) => `${rename.from} → ${rename.to}`)
                    .join(", ")}
                </span>
              </p>
            ) : null}
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
                if (!showPreview) openFirstFile(result, effectiveMode);
                setShowPreview((v) => !v);
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {showPreview ? "Hide Preview" : "Preview"}
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={async () => {
                setConfirming(true);
                try {
                  // The host writes the whole file map here — to disk in VS
                  // Code, over the network in pretext-plus — so this is a
                  // second stretch of dead time the user would otherwise see
                  // no feedback for.
                  await onConfirm(result, effectiveMode);
                } finally {
                  setConfirming(false);
                }
              }}
              className="flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              {confirming ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              {confirming
                ? insertTarget
                  ? "Inserting…"
                  : "Importing…"
                : insertTarget
                  ? "Confirm Insert"
                  : "Confirm Import"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="flex flex-col gap-4">
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
/** Total divisions in an outline tree, for the "n of m" count. */
function countDivisions(items: DivisionOutlineItem[]): number {
  return items.reduce(
    (total, item) => total + 1 + countDivisions(item.children),
    0,
  );
}

/**
 * Order two `DivisionPath`s the way the document does. Segment by segment and
 * numerically, so division 10 follows division 9 rather than division 1.
 */
function comparePaths(a: DivisionPath, b: DivisionPath): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * The division tree, one checkbox per division.
 *
 * Checking a parent does not check its children, because it does not have to:
 * a selected division is imported whole. Showing its children as checked would
 * claim they are individually selected, which changes what deselecting one of
 * them would mean.
 */
function DivisionPicker({
  items,
  selection,
  onToggle,
}: {
  items: DivisionOutlineItem[];
  selection: DivisionPath[];
  onToggle: (path: DivisionPath) => void;
}) {
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((item) => {
        const checked = selection.includes(item.path);
        const inherited = selection.some((pick) =>
          item.path.startsWith(`${pick}.`),
        );
        return (
          <li key={item.path}>
            <label className="flex items-baseline gap-2">
              <input
                type="checkbox"
                checked={checked || inherited}
                disabled={inherited}
                onChange={() => onToggle(item.path)}
              />
              <span className={inherited ? "text-slate-400" : "text-slate-700"}>
                {item.title || <em>Untitled</em>}
                <span className="ml-2 font-mono text-xs text-slate-400">
                  &lt;{item.tag}&gt;
                </span>
              </span>
            </label>
            {item.children.length > 0 ? (
              <div className="ml-5 border-l border-slate-200 pl-3">
                <DivisionPicker
                  items={item.children}
                  selection={selection}
                  onToggle={onToggle}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

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
