import type {
  Diagnostic,
  DiagnosticSeverityValue,
  Rule,
  Ruleset,
  SchemaError,
} from "./types";

/** Numeric DiagnosticSeverity values (mirrors vscode-languageserver-types). */
export const Severity = {
  Error: 1 as DiagnosticSeverityValue,
  Warning: 2 as DiagnosticSeverityValue,
  Information: 3 as DiagnosticSeverityValue,
  Hint: 4 as DiagnosticSeverityValue,
};

/**
 * A small default ruleset. It mostly passes salve's errors through with a stable
 * `code` and the `pretext` source, but rewrites the two most common structural
 * errors into friendlier prose.
 */
export const defaultRuleset: Ruleset = {
  source: "pretext",
  defaultSeverity: Severity.Error,
  rules: [
    {
      id: "element-me-removed",
      match: (e) => e.kind === "element-not-allowed" && e.name === "me",
      message: () =>
        `<me> should be replaced with <md> (without any <mrow>).`,
      severity: Severity.Warning,
    },
    {
      id: "element-not-allowed",
      match: (e) => e.kind === "element-not-allowed",
      message: (e) =>
        `<${e.name ?? "element"}> is not allowed here.` +
        (e.alternatives && e.alternatives.length
          ? ` Expected one of: ${formatList(e.alternatives)}.`
          : ""),
    },
    {
      id: "attribute-not-allowed",
      match: (e) => e.kind === "attribute-not-allowed",
      message: (e) =>
        `The attribute "${e.name ?? ""}" is not allowed on this element.`,
    },
    {
      id: "attribute-value-invalid",
      match: (e) => e.kind === "attribute-value-invalid",
    },
    {
      id: "choice-not-satisfied",
      match: (e) => e.kind === "choice-not-satisfied",
      message: (e) =>
        e.alternatives && e.alternatives.length
          ? `Missing required content. Expected one of: ${formatList(
              e.alternatives,
            )}.`
          : e.message,
    },
    {
      id: "text-not-allowed",
      match: (e) => e.kind === "text-not-allowed",
      message: () => "Text is not allowed here.",
    },
    {
      id: "unexpected-end",
      match: (e) => e.kind === "unexpected-end",
    },
    {
      id: "xinclude-missing",
      match: (e) => e.kind === "xinclude-missing",
    },
    {
      id: "xinclude-circular",
      match: (e) => e.kind === "xinclude-circular",
    },
    {
      id: "well-formedness",
      match: (e) => e.kind === "well-formedness",
    },
    {
      id: "duplicate-id",
      match: (e) => e.kind === "duplicate-id",
    },
    {
      id: "dangling-reference",
      match: (e) => e.kind === "dangling-reference",
    },
  ],
};

/**
 * Extra rules layered on top of the {@link defaultRuleset} in "relaxed"
 * validation mode. Each entry suppresses a schema violation that PreTeXt authors
 * commonly and legitimately hit but the stable schema does not (yet) permit.
 *
 * These are prepended before the generic pass-through rules so their `suppress`
 * wins (rule matching stops at the first match). Add new relaxations here.
 */
export const relaxedRules: Rule[] = [
  {
    // <document-id> is used by some publishers / build pipelines inside
    // <docinfo> but isn't in the stable schema yet.
    id: "allow-document-id",
    match: (e) =>
      e.kind === "element-not-allowed" &&
      e.name === "document-id" &&
      e.parent === "docinfo",
    suppress: true,
  },
  {
    // <blurb> inside <docinfo> (short description used by some output formats).
    id: "allow-blurb",
    match: (e) =>
      e.kind === "element-not-allowed" &&
      e.name === "blurb" &&
      e.parent === "docinfo",
    suppress: true,
  },
];

/**
 * The relaxed ruleset: the {@link defaultRuleset} with {@link relaxedRules}
 * taking precedence, so the listed violations are silently ignored. Selected
 * when the user opts into relaxed schema validation.
 */
export const relaxedRuleset: Ruleset = {
  ...defaultRuleset,
  rules: [...relaxedRules, ...defaultRuleset.rules],
};

function formatList(names: string[]): string {
  const unique = [...new Set(names)];
  const shown = unique.slice(0, 12).map((n) => `<${n}>`);
  if (unique.length > shown.length) {
    shown.push(`… (${unique.length - shown.length} more)`);
  }
  return shown.join(", ");
}

/**
 * Turn raw {@link SchemaError}s into LSP {@link Diagnostic}s, applying the first
 * matching rule's severity/message overrides and suppressions.
 */
export function applyRules(
  errors: SchemaError[],
  ruleset: Ruleset = defaultRuleset,
): Diagnostic[] {
  const defaultSeverity = ruleset.defaultSeverity ?? Severity.Error;
  const source = ruleset.source ?? "pretext";
  const diagnostics: Diagnostic[] = [];

  for (const error of errors) {
    const rule = ruleset.rules.find((r) => r.match(error));
    if (rule?.suppress) {
      continue;
    }
    diagnostics.push({
      range: error.range,
      severity: rule?.severity ?? defaultSeverity,
      code: rule?.id,
      source,
      message: rule?.message ? rule.message(error) : error.message,
    });
  }

  return diagnostics;
}
