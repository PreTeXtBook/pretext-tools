import { useMemo, useState } from "react";
import { convertSourceToPretext } from "../lib/convert";
import { detectSourceFormat } from "../lib/detect-source-format";
import type { ConvertedPretextResult, SourceFormat } from "../lib/types";

export interface ImportSourceFormLabels {
  title?: string;
  description?: string;
  sourceLabel?: string;
  sourcePlaceholder?: string;
  formatLabel?: string;
  convertButton?: string;
  detectedFormatPrefix?: string;
  successPrefix?: string;
  errorPrefix?: string;
}

export interface ImportSourceFormProps {
  initialSource?: string;
  initialSourceFormat?: SourceFormat;
  labels?: ImportSourceFormLabels;
  disabled?: boolean;
  onImport: (result: ConvertedPretextResult) => void;
}

const DEFAULT_LABELS: Required<ImportSourceFormLabels> = {
  title: "Import Source Content",
  description:
    "Paste LaTeX, Markdown, or PreTeXt source to convert into PreTeXt.",
  sourceLabel: "Source",
  sourcePlaceholder: "Paste source content here...",
  formatLabel: "Source format",
  convertButton: "Convert to PreTeXt",
  detectedFormatPrefix: "Detected",
  successPrefix: "Ready",
  errorPrefix: "Error",
};

export function ImportSourceForm({
  initialSource = "",
  initialSourceFormat,
  labels,
  disabled = false,
  onImport,
}: ImportSourceFormProps) {
  const text = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labels ?? {}) }),
    [labels],
  );

  const [source, setSource] = useState(initialSource);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat | "auto">(
    initialSourceFormat ?? "auto",
  );
  const [lastResult, setLastResult] = useState<ConvertedPretextResult | null>(
    null,
  );

  const detectedSourceFormat = useMemo(
    () => detectSourceFormat(source),
    [source],
  );

  const submitDisabled = disabled || !source.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const result = convertSourceToPretext(
          source,
          sourceFormat === "auto" ? undefined : sourceFormat,
        );
        setLastResult(result);
        onImport(result);
      }}
      aria-label="Import source form"
    >
      <fieldset disabled={disabled}>
        <legend>{text.title}</legend>
        <p>{text.description}</p>

        <label>
          {text.sourceLabel}
          <textarea
            value={source}
            onChange={(event) => setSource(event.currentTarget.value)}
            placeholder={text.sourcePlaceholder}
            rows={12}
          />
        </label>

        <label>
          {text.formatLabel}
          <select
            value={sourceFormat}
            onChange={(event) =>
              setSourceFormat(
                event.currentTarget.value as SourceFormat | "auto",
              )
            }
          >
            <option value="auto">Auto detect</option>
            <option value="latex">LaTeX</option>
            <option value="markdown">Markdown</option>
            <option value="pretext">PreTeXt</option>
          </select>
        </label>

        <p>
          {text.detectedFormatPrefix}: <strong>{detectedSourceFormat}</strong>
        </p>

        <button type="submit" disabled={submitDisabled}>
          {text.convertButton}
        </button>

        {lastResult ? (
          "pretextError" in lastResult ? (
            <p role="alert">
              {text.errorPrefix}: {lastResult.pretextError}
            </p>
          ) : (
            <p>
              {text.successPrefix}: {lastResult.pretextSource.length} characters
              of PreTeXt generated.
            </p>
          )
        ) : null}
      </fieldset>
    </form>
  );
}
