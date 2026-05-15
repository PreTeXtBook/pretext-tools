import { useMemo, useRef, useState } from "react";
import { handleImportUploadFile } from "../lib/upload";
import type { ImportedProjectResult, UploadStatusMessage } from "../lib/types";

export interface ImportUploadPanelLabels {
  title?: string;
  hint?: string;
  selectButton?: string;
  dropHint?: string;
}

export interface ImportUploadPanelProps {
  labels?: ImportUploadPanelLabels;
  disabled?: boolean;
  onImport: (result: ImportedProjectResult) => void;
}

const DEFAULT_LABELS: Required<ImportUploadPanelLabels> = {
  title: "Upload Source File",
  hint: "Supports .tex, .md, .ptx, .xml, .zip, and .tar.gz files.",
  selectButton: "Select File",
  dropHint: "Drop a file here, or click Select File.",
};

export function ImportUploadPanel({
  labels,
  disabled = false,
  onImport,
}: ImportUploadPanelProps) {
  const text = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labels ?? {}) }),
    [labels],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessages, setStatusMessages] = useState<UploadStatusMessage[]>(
    [],
  );

  const isDisabled = disabled || busy;

  const processFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await handleImportUploadFile(file);
      setStatusMessages(result.statusMessages);
      onImport(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Import upload panel">
      <h3>{text.title}</h3>
      <p>{text.hint}</p>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDisabled) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (isDisabled) {
            return;
          }
          const firstFile = event.dataTransfer.files?.[0];
          if (firstFile) {
            void processFile(firstFile);
          }
        }}
      >
        <p>{text.dropHint}</p>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Processing..." : text.selectButton}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          disabled={isDisabled}
          accept=".tex,.md,.markdown,.ptx,.xml,.zip,.gz,.tar.gz,.tgz"
          onChange={(event) => {
            const firstFile = event.currentTarget.files?.[0];
            if (firstFile) {
              void processFile(firstFile);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>

      {statusMessages.length > 0 ? (
        <ul aria-live="polite">
          {statusMessages.map((status, index) => (
            <li key={`${status.type}-${index}`}>{status.message}</li>
          ))}
        </ul>
      ) : null}

      {dragActive && !isDisabled ? <p>Release to upload the file.</p> : null}
    </section>
  );
}
