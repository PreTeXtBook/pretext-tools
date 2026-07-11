// Ported from PreprocessLaTeX/src/scan.js.

import {
  badBodyEnvironments,
  badEverywhereMacros,
  badEverywhereMacrosLine,
  badEverywhereMacrosPlus,
  badPlainTeX,
  eliminateAndSave,
  publisherOptions,
  specialBadMacros,
  type EnvironmentGroup,
  type MacroGroup,
  type MacroWithArityGroup,
} from "./latex-data";
import type { CleaningWarning } from "./warnings";

export interface PreambleBodyBiblio {
  preamble: string;
  body: string;
  bibliography: string;
}

export function separatePieces(input: string): PreambleBodyBiblio {
  const twoPieces = input.split("\\begin{document}");

  if (twoPieces.length < 2) {
    return { preamble: "", body: input, bibliography: "" };
  }

  const preamble = twoPieces[0];
  // If there are multiple \begin{document}s (auth bug), join the rest back.
  let body = twoPieces.slice(1).join("\\begin{document}");
  let bibliography = "";

  if (/\\begin\{thebibliography\}/.test(body)) {
    const [beforeBib, ...rest] = body.split("\\begin{thebibliography}");
    body = beforeBib;
    bibliography = rest.join("\\begin{thebibliography}");
  }

  return { preamble, body, bibliography };
}

type ScanType = "" | "line" | "hasarg";

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(name: string, type: ScanType, arity: number): RegExp {
  const escaped = escapeRegex(name);
  if (type === "hasarg") {
    let pattern = `\\\\${escaped}\\b\\*?`;
    for (let i = 0; i < arity; i += 1) {
      pattern += "\\{[^{}]*\\}";
    }
    return new RegExp(`(${pattern})`, "g");
  }
  if (type === "line") {
    return new RegExp(`(\\\\${escaped}\\b.*)`, "g");
  }
  return new RegExp(`(\\\\${escaped}\\b)`, "g");
}

interface ScanOptions {
  type?: ScanType;
  action?: "delete" | "mark";
  extra?: string;
  save?: boolean;
}

function noPlainTeX(
  source: string,
  group: MacroGroup | MacroWithArityGroup,
  options: ScanOptions,
  warnings: CleaningWarning[],
): string {
  const { type = "", action = "mark", extra = "", save = false } = options;
  const isWithArity = "macros" in group && typeof group.macros[0] === "object";

  let result = source;

  // Each group has shape: { kind, category, macros }
  // For MacroGroup, macros are strings; for MacroWithArityGroup, macros are {name, arity}.
  const macros = group.macros as Array<
    string | { name: string; arity: number }
  >;
  for (const entry of macros) {
    const name = typeof entry === "string" ? entry : entry.name;
    const arity = typeof entry === "string" ? 0 : entry.arity;
    const re = buildRegex(name, type, arity);
    const matches = result.match(re);
    if (!matches || matches.length === 0) {
      continue;
    }

    if (save) {
      warnings.push({
        action: "save",
        severity: "warning",
        kind: group.kind,
        category: group.category,
        macro: name,
        occurrences: matches.length,
        examples: matches.slice(0, 5),
        message: extra || undefined,
      });
    }

    if (action === "delete") {
      warnings.push({
        action: "delete",
        severity: "info",
        kind: group.kind,
        category: group.category,
        macro: name,
        occurrences: matches.length,
        message: extra || undefined,
      });
      result = result.replace(re, "");
    } else {
      warnings.push({
        action: "anomaly",
        severity: "warning",
        kind: group.kind,
        category: group.category,
        macro: name,
        occurrences: matches.length,
        message: extra || undefined,
        examples: matches.slice(0, 5),
      });
    }
    // Mention isWithArity to satisfy noUnusedLocals.
    void isWithArity;
  }

  return result;
}

function noBadEnvironments(
  source: string,
  group: EnvironmentGroup,
  warnings: CleaningWarning[],
): string {
  let result = source;
  for (const envName of group.environments) {
    const escaped = escapeRegex(envName);
    const re = new RegExp(`(\\\\(begin|end)\\{\\s*${escaped}\\})`, "g");
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      warnings.push({
        action: "delete",
        severity: "info",
        kind: group.kind,
        category: group.category,
        macro: envName,
        occurrences: matches.length,
      });
      result = result.replace(re, "");
    }
  }
  return result;
}

export function scanForAnomalies(source: string): {
  output: string;
  warnings: CleaningWarning[];
} {
  const warnings: CleaningWarning[] = [];
  const pieces = separatePieces(source);
  let { preamble, body } = pieces;
  const { bibliography } = pieces;

  for (const group of badEverywhereMacros) {
    preamble = noPlainTeX(preamble, group, { action: "delete" }, warnings);
    body = noPlainTeX(body, group, { action: "delete" }, warnings);
  }
  for (const group of specialBadMacros) {
    preamble = noPlainTeX(
      preamble,
      group,
      { type: "line", action: "delete", extra: "in the preamble", save: true },
      warnings,
    );
    body = noPlainTeX(
      body,
      group,
      { type: "line", action: "delete", extra: "in the main text", save: true },
      warnings,
    );
  }
  for (const group of eliminateAndSave) {
    preamble = noPlainTeX(
      preamble,
      group,
      { type: "line", action: "delete", extra: "in the preamble", save: true },
      warnings,
    );
    body = noPlainTeX(
      body,
      group,
      { type: "line", action: "delete", extra: "in the main text", save: true },
      warnings,
    );
  }
  for (const group of badEverywhereMacrosPlus) {
    preamble = noPlainTeX(
      preamble,
      group,
      { type: "hasarg", action: "delete" },
      warnings,
    );
    body = noPlainTeX(
      body,
      group,
      { type: "hasarg", action: "delete" },
      warnings,
    );
  }
  for (const group of badEverywhereMacrosLine) {
    preamble = noPlainTeX(
      preamble,
      group,
      { type: "line", action: "delete" },
      warnings,
    );
    body = noPlainTeX(
      body,
      group,
      { type: "line", action: "delete" },
      warnings,
    );
  }
  for (const group of publisherOptions) {
    preamble = noPlainTeX(
      preamble,
      group,
      {
        type: "line",
        action: "delete",
        extra: "this is a publisher choice in PreTeXt",
      },
      warnings,
    );
    body = noPlainTeX(
      body,
      group,
      {
        type: "line",
        action: "delete",
        extra: "this is a publisher choice in PreTeXt",
      },
      warnings,
    );
  }
  for (const group of badPlainTeX) {
    body = noPlainTeX(body, group, { action: "mark" }, warnings);
  }
  for (const group of badBodyEnvironments) {
    body = noBadEnvironments(body, group, warnings);
  }

  const hadDocument = source.includes("\\begin{document}");
  const hadBiblio = bibliography.length > 0;

  let output = preamble;
  if (hadDocument) {
    output += "\\begin{document}\n" + body;
  } else {
    // No \begin{document} in input — preserve original layout.
    output = body;
  }
  if (hadBiblio) {
    output += "\\begin{thebibliography}\n" + bibliography;
  }

  return { output, warnings };
}
