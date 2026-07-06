import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import { Diagnostic } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  validateDocument,
  loadGrammarFromJSON,
  defaultRuleset,
  relaxedRuleset,
  type Grammar,
  type FileReader,
  type Ruleset,
} from "@pretextbook/schema";
import { schemaDir } from "./main";
import { documents } from "./state";
import { isProjectPtx } from "./projectPtx/is-project-ptx";
import { isPublicationPtx } from "./completions/utils";

let grammar: Grammar | undefined;

/** The active ruleset: the strict default, or the relaxed one when opted in. */
let ruleset: Ruleset = defaultRuleset;

/**
 * Select the validation ruleset from the `pretext-tools.schema.validationMode`
 * setting. `"Relaxed"` suppresses a curated set of harmless violations; anything
 * else (including undefined) uses the strict default ruleset.
 */
export function setValidationMode(mode: string | undefined): void {
  ruleset = mode === "Relaxed" ? relaxedRuleset : defaultRuleset;
}

/**
 * Load the precompiled RELAX NG grammar used for schema validation. Prefers the
 * experimental grammar when requested, falling back to the stable one (the
 * experimental grammar is not always compilable due to upstream dangling refs).
 */
export function loadValidationGrammar(versionName: string | undefined): void {
  const candidates =
    versionName === "Experimental"
      ? ["pretext-dev.json", "pretext.json"]
      : ["pretext.json"];
  for (const name of candidates) {
    const file = path.join(schemaDir, name);
    try {
      if (fs.existsSync(file)) {
        grammar = loadGrammarFromJSON(fs.readFileSync(file, "utf8"));
        console.log(`Loaded validation grammar: ${name}`);
        return;
      }
    } catch (error) {
      console.error(`Failed to load validation grammar ${name}:`, error);
    }
  }
  console.warn(`No precompiled validation grammar found in ${schemaDir}`);
}

export function isValidationGrammarLoaded(): boolean {
  return grammar !== undefined;
}

/** The loaded validation grammar, if any (used for schema-driven completions). */
export function getValidationGrammar(): Grammar | undefined {
  return grammar;
}

/**
 * True for documents that should be validated against the main PreTeXt grammar:
 * ordinary `.ptx`/`.xml` source files, but not `project.ptx` or publication
 * files (which use different schemas).
 */
export function shouldValidate(document: TextDocument): boolean {
  const uri = document.uri;
  if (!/\.(ptx|xml)$/i.test(uri)) {
    return false;
  }
  if (isProjectPtx(uri)) {
    return false;
  }
  if (isPublicationPtx(document)) {
    return false;
  }
  return true;
}

/** A file reader that prefers in-memory (open) documents over disk. */
function makeReadFile(): FileReader {
  return (absolutePath: string) => {
    const uri = URI.file(absolutePath).toString();
    const open = documents.get(uri);
    if (open) {
      return open.getText();
    }
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  };
}

type PublishFn = (uri: string, diagnostics: Diagnostic[]) => void;

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, AbortController>();
// Tracks which URIs we have published diagnostics to on behalf of a primary
// document, so we can clear stale ones (e.g. after an xi:include is removed).
const publishedFor = new Map<string, Set<string>>();

const DEBOUNCE_MS = 300;

/** Debounced entry point: schedule validation for a changed document. */
export function scheduleValidation(
  document: TextDocument,
  publish: PublishFn,
): void {
  const uri = document.uri;
  const existing = debounceTimers.get(uri);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    runValidation(document, publish);
  }, DEBOUNCE_MS);
  debounceTimers.set(uri, timer);
}

function runValidation(document: TextDocument, publish: PublishFn): void {
  if (!grammar) {
    return;
  }
  const uri = document.uri;

  // Cancel any in-flight validation for this document.
  inflight.get(uri)?.abort();
  const controller = new AbortController();
  inflight.set(uri, controller);

  try {
    const result = validateDocument(document.getText(), grammar, {
      uri,
      signal: controller.signal,
      readFile: makeReadFile(),
      ruleset,
    });

    const currentTargets = new Set(Object.keys(result.diagnosticsByUri));
    for (const [target, diagnostics] of Object.entries(
      result.diagnosticsByUri,
    )) {
      publish(target, diagnostics);
    }

    // Clear diagnostics from files we previously reported on but no longer do.
    const previous = publishedFor.get(uri);
    if (previous) {
      for (const stale of previous) {
        if (!currentTargets.has(stale)) {
          publish(stale, []);
        }
      }
    }
    publishedFor.set(uri, currentTargets);
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      console.error("Schema validation failed:", error);
    }
  } finally {
    inflight.delete(uri);
  }
}

/** Clear scheduled/inflight validation and published diagnostics for a document. */
export function clearValidation(uri: string, publish: PublishFn): void {
  const timer = debounceTimers.get(uri);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(uri);
  }
  inflight.get(uri)?.abort();
  inflight.delete(uri);

  const previous = publishedFor.get(uri);
  if (previous) {
    for (const target of previous) {
      publish(target, []);
    }
    publishedFor.delete(uri);
  }
}
