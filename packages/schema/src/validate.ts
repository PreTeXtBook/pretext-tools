import { SaxesParser } from "saxes";
import type {
  Diagnostic,
  Range,
  Ruleset,
  SchemaError,
  SchemaErrorKind,
  ValidateOptions,
  ValidationResult,
  Grammar,
} from "./types";
import { applyRules, defaultRuleset, Severity } from "./rules";
import {
  resolveXIncludes,
  defaultFileReader,
  type OriginEntry,
} from "./xinclude";

/** The XML namespace URI used for xmlns:* declarations. */
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

interface WalkerLike {
  fireEvent(name: string, params: string[]): false | unknown[];
  end(): false | unknown[];
}

/**
 * Validate an XML document against a compiled PreTeXt grammar. Resolves
 * `xi:include`s first (unless disabled) and maps errors in included files back
 * to their originating file/line.
 */
export function validateDocument(
  source: string,
  grammar: Grammar,
  options: ValidateOptions = {},
): ValidationResult {
  const uri = options.uri ?? "untitled:document";
  const ruleset = options.ruleset ?? defaultRuleset;
  const resolve = options.resolveXIncludes ?? true;
  const readFile = options.readFile ?? defaultFileReader();

  throwIfAborted(options.signal);

  let mergedText = source;
  let origin: OriginEntry[] | undefined;
  const errors: SchemaError[] = [];

  if (resolve && /<xi:include\b/.test(source)) {
    const resolved = resolveXIncludes(source, uri, readFile);
    mergedText = resolved.text;
    origin = resolved.origin;
    for (const problem of resolved.problems) {
      errors.push({
        kind: problem.kind,
        message: problem.message,
        uri: problem.uri,
        range: singleLineRange(problem.line, problem.column, problem.length),
      });
    }
  }

  errors.push(...driveValidation(mergedText, grammar, uri, origin, options.signal));

  return toResult(errors, uri, ruleset);
}

/** Drive saxes events through the salve walker, collecting normalized errors. */
function driveValidation(
  text: string,
  grammar: Grammar,
  documentUri: string,
  origin: OriginEntry[] | undefined,
  signal: AbortSignal | undefined,
): SchemaError[] {
  const walker = grammar.newWalker() as WalkerLike;
  const errors: SchemaError[] = [];
  const parser = new SaxesParser<{ xmlns: true; position: true }>({
    xmlns: true,
    position: true,
  });

  let depth = 0;
  // Start position (0-based line/char) and length of the tag currently being
  // entered, captured at `opentagstart` for precise element/attribute ranges.
  let tagStart: { line: number; char: number; length: number } | null = null;

  const map = (line0: number, char: number): { uri: string; line: number; char: number } => {
    if (!origin) {
      return { uri: documentUri, line: line0, char };
    }
    const entry = origin[line0] ?? origin[origin.length - 1];
    if (!entry) {
      return { uri: documentUri, line: line0, char };
    }
    return {
      uri: entry.uri,
      line: entry.line,
      char: Math.max(0, char - entry.columnShift),
    };
  };

  const rangeFrom = (line0: number, startChar: number, endChar: number): { uri: string; range: Range } => {
    const s = map(line0, startChar);
    const e = map(line0, endChar);
    return {
      uri: s.uri,
      range: {
        start: { line: s.line, character: Math.max(0, s.char) },
        end: { line: e.line, character: Math.max(s.char, e.char) },
      },
    };
  };

  const record = (raw: unknown[], loc: { uri: string; range: Range }) => {
    for (const err of raw) {
      const norm = normalizeError(err);
      errors.push({ ...norm, uri: loc.uri, range: loc.range });
    }
  };

  const fire = (name: string, params: string[], loc: { uri: string; range: Range }) => {
    const ret = walker.fireEvent(name, params);
    if (Array.isArray(ret)) {
      record(ret, loc);
    }
  };

  parser.on("opentagstart", (tag) => {
    // column is 1-based index of the next char to read (just past the name).
    const line0 = parser.line - 1;
    const nameEnd = parser.column - 1;
    const nameStart = nameEnd - tag.name.length;
    const ltStart = Math.max(0, nameStart - 1); // the "<"
    tagStart = { line: line0, char: ltStart, length: nameEnd - ltStart };
  });

  parser.on("opentag", (node) => {
    depth++;
    const start = tagStart ?? {
      line: parser.line - 1,
      char: Math.max(0, parser.column - 1),
      length: 1,
    };
    const tagLoc = rangeFrom(start.line, start.char, start.char + start.length);

    fire("enterStartTag", [node.uri ?? "", node.local ?? node.name], tagLoc);
    for (const attrName of Object.keys(node.attributes)) {
      const attr = node.attributes[attrName] as {
        uri?: string;
        prefix?: string;
        local?: string;
        name: string;
        value: string;
      };
      if (attr.prefix === "xmlns" || attr.name === "xmlns" || attr.uri === XMLNS_NS) {
        continue;
      }
      fire("attributeName", [attr.uri ?? "", attr.local ?? attr.name], tagLoc);
      fire("attributeValue", [attr.value], tagLoc);
    }
    fire("leaveStartTag", [], tagLoc);
  });

  parser.on("closetag", (node) => {
    const line0 = parser.line - 1;
    const char = Math.max(0, parser.column - 1);
    const loc = rangeFrom(line0, Math.max(0, char - 1), char);
    fire("endTag", [node.uri ?? "", node.local ?? node.name], loc);
    depth = Math.max(0, depth - 1);
  });

  parser.on("text", (t) => {
    if (depth === 0) {
      return; // ignore prolog / inter-element whitespace at the document root
    }
    if (t.length === 0) {
      return;
    }
    const line0 = parser.line - 1;
    const endChar = Math.max(0, parser.column - 1);
    // Text may span lines; only the last line's column is known. Use a modest
    // range on the final line where saxes reports the position.
    const startChar = Math.max(0, endChar - lastLineLength(t));
    const loc = rangeFrom(line0, startChar, endChar);
    fire("text", [t], loc);
  });

  parser.on("error", (e) => {
    const line0 = parser.line - 1;
    const char = Math.max(0, parser.column - 1);
    const loc = map(line0, char);
    errors.push({
      kind: "well-formedness",
      message: e.message,
      uri: loc.uri,
      range: {
        start: { line: loc.line, character: loc.char },
        end: { line: loc.line, character: loc.char + 1 },
      },
    });
  });

  try {
    // Feed in chunks so cancellation can interrupt very large documents.
    const CHUNK = 1 << 16;
    for (let i = 0; i < text.length; i += CHUNK) {
      throwIfAborted(signal);
      parser.write(text.slice(i, i + CHUNK));
    }
    parser.close();
  } catch (e) {
    if (isAbortError(e)) {
      throw e;
    }
    // saxes throws on fatal well-formedness problems after emitting "error".
  }

  const endRet = walker.end();
  if (Array.isArray(endRet) && endRet.length) {
    const lastLine = Math.max(0, countLines(text) - 1);
    const loc = rangeFrom(lastLine, 0, 1);
    record(endRet, loc);
  }

  return errors;
}

function toResult(
  errors: SchemaError[],
  primaryUri: string,
  ruleset: Ruleset,
): ValidationResult {
  const grouped = new Map<string, SchemaError[]>();
  for (const err of errors) {
    const list = grouped.get(err.uri) ?? [];
    list.push(err);
    grouped.set(err.uri, list);
  }

  const diagnosticsByUri: Record<string, Diagnostic[]> = {};
  for (const [uri, list] of grouped) {
    diagnosticsByUri[uri] = applyRules(list, ruleset);
  }
  if (!diagnosticsByUri[primaryUri]) {
    diagnosticsByUri[primaryUri] = [];
  }

  return { diagnostics: diagnosticsByUri[primaryUri], diagnosticsByUri };
}

/** Map a salve error object onto our normalized {@link SchemaError} shape. */
function normalizeError(err: unknown): Pick<
  SchemaError,
  "kind" | "message" | "name" | "ns" | "alternatives"
> {
  const anyErr = err as {
    constructor: { name: string };
    msg?: string;
    name?: unknown;
    toString(): string;
    getNames?: () => unknown[];
  };
  const ctor = anyErr.constructor?.name ?? "";
  const message = anyErr.msg ?? anyErr.toString();

  let kind: SchemaErrorKind = "other";
  switch (ctor) {
    case "ElementNameError":
      kind = "element-not-allowed";
      break;
    case "AttributeNameError":
      kind = "attribute-not-allowed";
      break;
    case "AttributeValueError":
      kind = "attribute-value-invalid";
      break;
    case "ChoiceError":
      kind = "choice-not-satisfied";
      break;
    default:
      if (/text (is )?not allowed/i.test(message)) {
        kind = "text-not-allowed";
      } else if (/must choose|tag required|incomplete|nothing else may follow/i.test(message)) {
        kind = "choice-not-satisfied";
      }
  }

  const primary = patternNames(anyErr.name);
  // Only choice errors carry a meaningful set of *expected* alternatives. For
  // single-name errors, getNames() just repeats the offending name, so we omit
  // alternatives there to avoid nonsensical "expected one of: <the-bad-name>".
  const alternatives =
    kind === "choice-not-satisfied" && typeof anyErr.getNames === "function"
      ? [...new Set(anyErr.getNames().flatMap((n) => patternNames(n)))]
      : undefined;

  return {
    kind,
    message,
    name: primary[0],
    alternatives: alternatives && alternatives.length ? alternatives : undefined,
  };
}

/** Extract concrete local names from a salve name pattern (Name/NameChoice/...). */
function patternNames(pattern: unknown): string[] {
  if (!pattern || typeof pattern !== "object") {
    return [];
  }
  const p = pattern as {
    toArray?: () => Array<{ name?: string; toObject?: () => { name?: string } }> | null;
    toObject?: () => { name?: string };
    name?: string;
  };
  if (typeof p.toArray === "function") {
    const arr = p.toArray();
    if (arr) {
      return arr
        .map((n) => n.name ?? n.toObject?.().name)
        .filter((n): n is string => typeof n === "string");
    }
  }
  const obj = p.toObject?.();
  if (obj && typeof obj.name === "string") {
    return [obj.name];
  }
  if (typeof p.name === "string") {
    return [p.name];
  }
  return [];
}

function singleLineRange(line: number, char: number, length: number): Range {
  return {
    start: { line, character: char },
    end: { line, character: char + length },
  };
}

function lastLineLength(text: string): number {
  const idx = text.lastIndexOf("\n");
  return idx === -1 ? text.length : text.length - idx - 1;
}

function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      n++;
    }
  }
  return n;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw makeAbortError();
  }
}

function makeAbortError(): Error {
  const err = new Error("Validation aborted");
  err.name = "AbortError";
  return err;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

// Re-export for convenience.
export { Severity };
