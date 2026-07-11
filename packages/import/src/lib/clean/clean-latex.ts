import { badPlainTeXdirectives } from "./latex-data";
import { fixPlainTeX, specialPreprocess } from "./latex-clean";
import { scanForAnomalies } from "./latex-scan";
import { trimJunk } from "./latex-utils";
import type { CleaningWarning } from "./warnings";

export interface CleanLatexResult {
  output: string;
  warnings: CleaningWarning[];
}

// Mirrors the LaTeX side of PreprocessLaTeX's describeFiles().
export function cleanLatex(source: string): CleanLatexResult {
  const warnings: CleaningWarning[] = [];
  let text = trimJunk(source).replace(/(\n *){3,}/g, "\n\n");

  const special = specialPreprocess(text);
  text = special.output;
  warnings.push(...special.warnings);

  // Two passes catch nested directives like {\sf\bf ...}.
  const fix1 = fixPlainTeX(text, badPlainTeXdirectives);
  text = fix1.output;
  warnings.push(...fix1.warnings);

  const fix2 = fixPlainTeX(text, badPlainTeXdirectives);
  text = fix2.output;
  warnings.push(...fix2.warnings);

  const scan = scanForAnomalies(text);
  text = scan.output.replace(/(\n *){3,}/g, "\n\n");
  warnings.push(...scan.warnings);

  return { output: text, warnings };
}
