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
import { schemaDir } from "./paths";
import { documents } from "./state";
import { isProjectPtx } from "./projectPtx/is-project-ptx";
import { findProjectRootDocuments } from "./projectPtx/find-root-documents";
import { isPublicationPtx } from "./completions/utils";

/**
 * Which of PreTeXt's three grammars a document is validated against.
 *
 * A PreTeXt project mixes three unrelated XML vocabularies in files that all
 * end in `.ptx`: the manifest (`project.ptx`), the publication file, and the
 * source documents themselves. Each has its own schema, and validating one
 * against another's grammar reports every element as disallowed — which is
 * why the two non-source kinds used to be skipped entirely rather than
 * mis-validated.
 */
export type SchemaKind = "pretext" | "project" | "publication";

/** Precompiled grammar per kind; absent when the asset failed to load. */
const grammars = new Map<SchemaKind, Grammar>();

/** The active ruleset: the strict default, or the relaxed one when opted in. */
let ruleset: Ruleset = defaultRuleset;

/**
 * Which grammar `document` should be validated against.
 *
 * `project.ptx` is identified by filename and the publication file by its
 * root element — it has no fixed name (the manifest points at it, and
 * `publication/publication.ptx` is only a convention). Order matters: the
 * manifest is checked first so a `project.ptx` that happens to mention
 * `<publication>` is still treated as a manifest.
 */
export function documentSchemaKind(document: TextDocument): SchemaKind {
  if (isProjectPtx(document.uri)) {
    return "project";
  }
  if (isPublicationPtx(document)) {
    return "publication";
  }
  return "pretext";
}

/**
 * Select the validation ruleset from the `pretext-tools.schema.validationMode`
 * setting. `"Relaxed"` suppresses a curated set of harmless violations; anything
 * else (including undefined) uses the strict default ruleset.
 */
export function setValidationMode(mode: string | undefined): void {
  ruleset = mode === "Relaxed" ? relaxedRuleset : defaultRuleset;
}

/** Load one precompiled grammar from `schemaDir`, or undefined if unusable. */
function loadGrammarFile(name: string): Grammar | undefined {
  const file = path.join(schemaDir, name);
  try {
    if (fs.existsSync(file)) {
      return loadGrammarFromJSON(fs.readFileSync(file, "utf8"));
    }
  } catch (error) {
    console.error(`Failed to load validation grammar ${name}:`, error);
  }
  return undefined;
}

/**
 * Load the precompiled RELAX NG grammars used for schema validation.
 *
 * For source documents, prefers the experimental grammar when requested and
 * falls back to the stable one (the experimental grammar is not always
 * compilable due to upstream dangling refs). The manifest and publication
 * grammars have no such variants — they are versionless — so they are loaded
 * once and left alone by later version switches.
 *
 * A kind whose grammar is missing is simply not validated (see
 * {@link shouldValidate}), which is the pre-existing behaviour for that file.
 */
export function loadValidationGrammar(versionName: string | undefined): void {
  const candidates =
    versionName === "Experimental"
      ? ["pretext-dev.json", "pretext.json"]
      : ["pretext.json"];
  grammars.delete("pretext");
  for (const name of candidates) {
    const loaded = loadGrammarFile(name);
    if (loaded) {
      grammars.set("pretext", loaded);
      console.log(`Loaded validation grammar: ${name}`);
      break;
    }
  }
  if (!grammars.has("pretext")) {
    console.warn(`No precompiled validation grammar found in ${schemaDir}`);
  }

  for (const [kind, name] of [
    ["project", "project-ptx.json"],
    ["publication", "publication-schema.json"],
  ] as const) {
    if (grammars.has(kind)) {
      continue;
    }
    const loaded = loadGrammarFile(name);
    if (loaded) {
      grammars.set(kind, loaded);
      console.log(`Loaded validation grammar: ${name}`);
    } else {
      console.warn(`No ${kind} validation grammar found in ${schemaDir}`);
    }
  }
}

export function isValidationGrammarLoaded(): boolean {
  return grammars.has("pretext");
}

/**
 * The loaded grammar for a kind, defaulting to the source-document one (which
 * is what schema-driven completions use).
 */
export function getValidationGrammar(
  kind: SchemaKind = "pretext",
): Grammar | undefined {
  return grammars.get(kind);
}

/**
 * True for documents that should be schema-validated: any `.ptx`/`.xml` file.
 * `project.ptx` and publication files are included — each validated against
 * its own grammar, see {@link documentSchemaKind}.
 *
 * Deliberately a pure predicate about the document, not about what is loaded:
 * whether a grammar is actually available is {@link runValidation}'s guard, so
 * this stays testable and a missing grammar degrades to "validated against
 * nothing" rather than changing which files are considered validatable.
 */
export function shouldValidate(document: TextDocument): boolean {
  return /\.(ptx|xml)$/i.test(document.uri);
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
  const uri = document.uri;
  const kind = documentSchemaKind(document);
  const grammar = grammars.get(kind);
  if (!grammar) {
    // Nothing to validate against, so nothing can be reported — clear anything
    // still showing. Without this, diagnostics published by another producer
    // (the manifest's XML parse errors) would stick permanently once the user
    // fixed them: the follow-up validation that should have replaced them
    // would return here having published nothing.
    if (publishedFor.get(uri)?.size) {
      for (const target of publishedFor.get(uri)!) {
        publish(target, []);
      }
    }
    publish(uri, []);
    publishedFor.delete(uri);
    return;
  }

  // Cancel any in-flight validation for this document.
  inflight.get(uri)?.abort();
  const controller = new AbortController();
  inflight.set(uri, controller);

  try {
    const readFile = makeReadFile();
    // The manifest and publication file sit outside the book's xi:include
    // graph: they declare no xml:id/label and reference none, so resolving
    // includes (and with it the book-wide id/label collection those checks
    // need) would be pure cost — and would risk reporting an id in the
    // manifest as colliding with the same id in the source it points at.
    const isSource = kind === "pretext";
    const result = validateDocument(document.getText(), grammar, {
      uri,
      signal: controller.signal,
      readFile,
      ruleset,
      ...(isSource
        ? { rootDocuments: findProjectRootDocuments(uri, readFile) }
        : { resolveXIncludes: false }),
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

/**
 * Cancel any scheduled or in-flight validation for a document *without*
 * touching the diagnostics already published for it.
 *
 * For callers that are about to publish diagnostics of their own to the same
 * URI (the manifest's XML parse errors) and would otherwise race a pending
 * schema run that overwrites them a moment later. Unlike
 * {@link clearValidation} this publishes nothing, so it does not blank the
 * caller's diagnostics on the way past.
 */
export function cancelValidation(uri: string): void {
  const timer = debounceTimers.get(uri);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(uri);
  }
  inflight.get(uri)?.abort();
  inflight.delete(uri);
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
