import { formatPretext } from "@pretextbook/format";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { detectSourceFormat } from "./detect-source-format";
import type { ConvertedPretextResult, SourceFormat } from "./types";

function asConvertedString(converted: unknown): string {
  if (typeof converted === "string") {
    return converted;
  }

  if (
    typeof converted === "object" &&
    converted !== null &&
    "value" in converted
  ) {
    const value = (converted as { value?: unknown }).value;
    if (typeof value === "string") {
      return value;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  return String(converted);
}

export function normalizePretextSource(pretextSource: string): string {
  const trimmedPretext = pretextSource.trim();
  if (!trimmedPretext) {
    return "";
  }
  return formatPretext(trimmedPretext);
}

export function convertLatexToPretext(latexSource: string): string {
  const trimmedLatex = latexSource.trim();
  if (!trimmedLatex) {
    return "";
  }

  const converted = asConvertedString(latexToPretext(trimmedLatex)).trim();
  return converted ? normalizePretextSource(converted) : "";
}

export function convertMarkdownToPretext(markdownSource: string): string {
  const trimmedMarkdown = markdownSource.trim();
  if (!trimmedMarkdown) {
    return "";
  }

  const converted = String(markdownToPretext(trimmedMarkdown)).trim();
  return converted ? normalizePretextSource(converted) : "";
}

export function getConversionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Could not convert source content to PreTeXt.";
}

export function convertSourceToPretext(
  source: string,
  sourceFormat?: SourceFormat,
): ConvertedPretextResult {
  const detectedSourceFormat = detectSourceFormat(source);
  const finalSourceFormat = sourceFormat ?? detectedSourceFormat;

  try {
    if (finalSourceFormat === "pretext") {
      return {
        sourceFormat: finalSourceFormat,
        detectedSourceFormat,
        pretextSource: normalizePretextSource(source),
      };
    }

    if (finalSourceFormat === "markdown") {
      return {
        sourceFormat: finalSourceFormat,
        detectedSourceFormat,
        pretextSource: convertMarkdownToPretext(source),
      };
    }

    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextSource: convertLatexToPretext(source),
    };
  } catch (error) {
    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextError: getConversionErrorMessage(error),
    };
  }
}
