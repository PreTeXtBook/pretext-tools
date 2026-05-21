import { formatPretext } from "@pretextbook/format";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { cleanLatex } from "./clean/clean-latex";
import type { CleaningWarning } from "./clean/warnings";
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

export interface LatexConversionResult {
  pretext: string;
  cleanedLatex: string;
  warnings: CleaningWarning[];
}

export function convertLatexToPretext(
  latexSource: string,
): LatexConversionResult {
  const trimmedLatex = latexSource.trim();
  if (!trimmedLatex) {
    return { pretext: "", cleanedLatex: "", warnings: [] };
  }

  const { output: cleanedLatex, warnings } = cleanLatex(trimmedLatex);
  if (!cleanedLatex.trim()) {
    return { pretext: "", cleanedLatex, warnings };
  }

  const converted = asConvertedString(latexToPretext(cleanedLatex)).trim();
  const pretext = converted ? normalizePretextSource(converted) : "";
  return { pretext, cleanedLatex, warnings };
}

export interface MarkdownConversionResult {
  pretext: string;
  cleanedMarkdown: string;
}

export function convertMarkdownToPretext(
  markdownSource: string,
): MarkdownConversionResult {
  const trimmedMarkdown = markdownSource.trim();
  if (!trimmedMarkdown) {
    return { pretext: "", cleanedMarkdown: "" };
  }

  const converted = String(markdownToPretext(trimmedMarkdown)).trim();
  const pretext = converted ? normalizePretextSource(converted) : "";
  return { pretext, cleanedMarkdown: trimmedMarkdown };
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
        warnings: [],
      };
    }

    if (finalSourceFormat === "markdown") {
      const { pretext, cleanedMarkdown } = convertMarkdownToPretext(source);
      return {
        sourceFormat: finalSourceFormat,
        detectedSourceFormat,
        pretextSource: pretext,
        cleanedNativeSource: cleanedMarkdown,
        warnings: [],
      };
    }

    const { pretext, cleanedLatex, warnings } = convertLatexToPretext(source);
    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextSource: pretext,
      cleanedNativeSource: cleanedLatex,
      warnings,
    };
  } catch (error) {
    return {
      sourceFormat: finalSourceFormat,
      detectedSourceFormat,
      pretextError: getConversionErrorMessage(error),
      warnings: [],
    };
  }
}
