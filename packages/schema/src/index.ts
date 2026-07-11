export { validateDocument } from "./validate";
export { getCompletions, clearCompletionCache } from "./completions";
export { loadGrammarFromJSON } from "./grammar";
export {
  applyRules,
  defaultRuleset,
  relaxedRuleset,
  relaxedRules,
  Severity,
} from "./rules";
export {
  resolveXIncludes,
  defaultFileReader,
  type OriginEntry,
  type IncludeProblem,
  type ResolvedDocument,
} from "./xinclude";
export { collectBookReferences, type BookReferences } from "./book";
export type {
  Grammar,
  Diagnostic,
  CompletionItem,
  CompletionContext,
  Range,
  Position,
  SchemaError,
  SchemaErrorKind,
  Rule,
  Ruleset,
  DiagnosticSeverityValue,
  FileReader,
  ValidateOptions,
  ValidationResult,
} from "./types";
