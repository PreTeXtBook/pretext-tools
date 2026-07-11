import { useMemo, useRef, useState } from 'react';
import {
  handleImportUploadFile,
  type ImportProjectOptions,
} from '../lib/upload';
import type { DocumentKind } from '../lib/layout/document-kind';
import type { ImportedProjectResult, UploadStatusMessage } from '../lib/types';

export interface ImportUploadPanelLabels {
  title?: string;
  hint?: string;
  selectButton?: string;
  dropHint?: string;
  documentKindLabel?: string;
  splitSectionsLabel?: string;
}

export interface ImportUploadPanelProps {
  labels?: ImportUploadPanelLabels;
  disabled?: boolean;
  /** Default document-kind option presented to the user; user can override. */
  defaultDocumentKind?: DocumentKind | 'auto';
  /** When provided, takes precedence — UI controls hidden. */
  importOptions?: ImportProjectOptions;
  onImport: (result: ImportedProjectResult) => void;
}

const DEFAULT_LABELS: Required<ImportUploadPanelLabels> = {
  title: 'Upload Source File',
  hint: 'Supports .tex, .md, .ptx, .xml, .zip, and .tar.gz files.',
  selectButton: 'Select File',
  dropHint: 'Drop a file here, or click Select File.',
  documentKindLabel: 'Document kind',
  splitSectionsLabel: 'Split each chapter into sections',
};

export function ImportUploadPanel({
  labels,
  disabled = false,
  defaultDocumentKind = 'auto',
  importOptions,
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
  const [documentKindChoice, setDocumentKindChoice] = useState<
    DocumentKind | 'auto'
  >(defaultDocumentKind);
  const [splitSections, setSplitSections] = useState(false);

  const isDisabled = disabled || busy;

  const processFile = async (file: File) => {
    setBusy(true);
    try {
      const resolvedOptions: ImportProjectOptions = importOptions ?? {
        documentKind:
          documentKindChoice === 'auto' ? undefined : documentKindChoice,
        splitSections,
      };
      const result = await handleImportUploadFile(file, resolvedOptions);
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
      {importOptions ? null : (
        <div className="import-options">
          <label>
            {text.documentKindLabel}
            <select
              value={documentKindChoice}
              disabled={isDisabled}
              onChange={(event) =>
                setDocumentKindChoice(
                  event.currentTarget.value as DocumentKind | 'auto',
                )
              }
            >
              <option value="auto">Auto detect</option>
              <option value="article">Article</option>
              <option value="book">Book</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={splitSections}
              disabled={isDisabled}
              onChange={(event) =>
                setSplitSections(event.currentTarget.checked)
              }
            />
            {text.splitSectionsLabel}
          </label>
        </div>
      )}
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
          {busy ? 'Processing...' : text.selectButton}
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
            event.currentTarget.value = '';
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
