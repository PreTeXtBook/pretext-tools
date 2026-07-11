import type { SourceFormat } from "./types";

export const LATEX_FORMAT_MARKERS = [
  "\\documentclass",
  "\\begin{document}",
  "\\begin{",
  "\\section",
  "\\chapter",
  "\\title",
  "\\author",
];

export const MARKDOWN_FORMAT_MARKERS = ["# ", "## ", "### ", "#### "];

export function detectSourceFormat(source: string): SourceFormat {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return "pretext";
  }

  if (trimmedSource.startsWith("<")) {
    return "pretext";
  }

  if (LATEX_FORMAT_MARKERS.some((marker) => trimmedSource.includes(marker))) {
    return "latex";
  }

  if (
    MARKDOWN_FORMAT_MARKERS.some((marker) => trimmedSource.startsWith(marker))
  ) {
    return "markdown";
  }

  return "pretext";
}
