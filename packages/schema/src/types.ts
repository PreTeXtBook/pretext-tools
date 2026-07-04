import type {
  Diagnostic,
  CompletionItem,
  Range,
  Position,
} from "vscode-languageserver-types";

export type { Diagnostic, CompletionItem, Range, Position };

/**
 * A grammar produced by salve from a (precompiled or freshly-converted) RELAX NG
 * schema. Kept opaque here so consumers do not need to depend on salve's types
 * directly.
 */
export interface Grammar {
  newWalker(): unknown;
}

/**
 * The category of a raw validation error, derived from salve's error class.
 * Rule predicates and message templates key off this.
 */
export type SchemaErrorKind =
  | "element-not-allowed"
  | "attribute-not-allowed"
  | "attribute-value-invalid"
  | "choice-not-satisfied"
  | "text-not-allowed"
  | "unexpected-end"
  | "xinclude-missing"
  | "xinclude-circular"
  | "well-formedness"
  | "other";

/**
 * A normalized validation error, produced before rule/severity/message
 * customization is applied. This is the shape rule predicates receive.
 */
export interface SchemaError {
  kind: SchemaErrorKind;
  /** The raw message produced by the underlying engine. */
  message: string;
  /** The element or attribute local name involved (when applicable). */
  name?: string;
  /** The namespace URI involved (when applicable). */
  ns?: string;
  /** Names offered as alternatives (e.g. for choice errors). */
  alternatives?: string[];
  /** Location of the error in the (mapped-back) source document. */
  range: Range;
  /** URI of the document the error belongs to (after XInclude mapping). */
  uri: string;
}

/**
 * A rule that customizes how a raw {@link SchemaError} becomes an LSP
 * {@link Diagnostic}: overriding severity, rewriting the message, tagging it
 * with a stable rule id, or filtering it out entirely.
 */
export interface Rule {
  /** Stable identifier reported as the diagnostic `code`. */
  id: string;
  /** Returns true if this rule applies to the given error. */
  match: (error: SchemaError) => boolean;
  /** Severity to report. Defaults to the ruleset default (Error). */
  severity?: DiagnosticSeverityValue;
  /** Rewrites the diagnostic message. Receives the raw error. */
  message?: (error: SchemaError) => string;
  /** When true, the error is suppressed rather than reported. */
  suppress?: boolean;
}

/** Mirrors `vscode-languageserver-types` DiagnosticSeverity numeric values. */
export type DiagnosticSeverityValue = 1 | 2 | 3 | 4;

export interface Ruleset {
  rules: Rule[];
  /** Severity applied when no rule overrides it. Defaults to Error (1). */
  defaultSeverity?: DiagnosticSeverityValue;
  /** Diagnostic `source` label. Defaults to "pretext". */
  source?: string;
}

/** Reads the contents of an absolute file path, or returns undefined if absent. */
export type FileReader = (absolutePath: string) => string | undefined;

export interface ValidateOptions {
  /** URI of the document being validated (used for reporting + XInclude base). */
  uri?: string;
  /** Cancels in-flight validation. */
  signal?: AbortSignal;
  /** Resolve `xi:include` references before validating. Default: true. */
  resolveXIncludes?: boolean;
  /** Reads included files. Defaults to a Node `fs` reader. */
  readFile?: FileReader;
  /** Rule customization applied to raw errors. Defaults to {@link defaultRuleset}. */
  ruleset?: Ruleset;
}

export interface ValidationResult {
  /** Diagnostics for the primary document ({@link ValidateOptions.uri}). */
  diagnostics: Diagnostic[];
  /** All diagnostics keyed by document URI (primary + XIncluded files). */
  diagnosticsByUri: Record<string, Diagnostic[]>;
}

export interface CompletionContext {
  /** Full source text of the document. */
  text: string;
  /** Cursor position (0-based line and character). */
  position: Position;
  /** The compiled grammar to consult. */
  grammar: Grammar;
}
