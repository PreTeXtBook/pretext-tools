/**
 * Round-trip machinery for the PreTeXt visual editor.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * The visual editor works by treating PreTeXt XML as if it were HTML:
 * `cleanPtx` wraps unknown tags in `<rawptx>`, TipTap/ProseMirror parses the
 * result against our custom schema, and `json2ptx` serializes the editor
 * state back to PreTeXt. ProseMirror's parser is *lossy by design*: any
 * content that doesn't fit the schema is silently dropped, lifted, or
 * re-wrapped. That is fine for a scratch editor; it is NOT fine when the
 * output overwrites an author's source file.
 *
 * The make-or-break property of this feature is therefore:
 *
 *     serialize(parse(document)) must equal document   (modulo formatting)
 *
 * This module makes that property (a) testable — see roundtrip.spec.ts and
 * roundtrip.gaps.spec.ts — and (b) enforceable at runtime via
 * `checkRoundTrip`, which the VisualEditor component uses as a safety guard:
 * if a document does not round-trip cleanly, editing stays disabled and the
 * user sees a warning instead of silently losing content.
 *
 * ── The comparison contract ───────────────────────────────────────────────
 *
 * Saving from the visual editor always rewrites the file through
 * `formatPretext` (that is existing, intentional behavior). So the honest
 * definition of "no data loss" is:
 *
 *     formatPretext(roundTrip(x)) === formatPretext(x)
 *
 * i.e. the only change a no-op edit session may make to a document is
 * formatting. Both sides go through the same formatter, so incidental
 * whitespace differences cancel out, while any dropped element, attribute,
 * or comment shows up as a mismatch. We deliberately compare strictly:
 * when in doubt, refuse to edit (safe refusal beats silent corruption).
 *
 * ── Environment note ──────────────────────────────────────────────────────
 *
 * `generateJSON` from @tiptap/core needs a DOM (`DOMParser`). That exists in
 * the browser/webview where the editor runs, and in tests via vitest's
 * jsdom environment (see vitest.config.ts). It does NOT exist in plain
 * Node — callers running server-side would need jsdom or @tiptap/html.
 */
import { generateJSON, getSchema } from "@tiptap/core";
import { formatPretext } from "@pretextbook/format";
import { editorExtensions } from "./editorExtensions";
import { json2ptx } from "./json2ptx";
import { cleanPtx } from "./utils";

/**
 * Names of node types that are inline in the editor schema (live inside a
 * paragraph's text flow — m, me, md, url, ...). json2ptx must serialize
 * these without injected newlines. Derived from the ACTUAL schema built
 * from editorExtensions rather than hand-listed, so adding a new inline
 * extension automatically keeps serialization correct. (Text itself and
 * hardBreak are also inline but are leaf nodes handled separately by
 * json2ptx; their presence in this set is harmless.)
 */
const inlineNodeNames: ReadonlySet<string> = new Set(
  Object.values(getSchema(editorExtensions).nodes)
    .filter((type) => type.isInline)
    .map((type) => type.name),
);

/**
 * TipTap's JSON document shape. We keep this loose (rather than importing
 * TipTap's `JSONContent`) because `json2ptx` has its own structural type and
 * everything here just passes the JSON through opaquely.
 */
export type EditorJson = Record<string, unknown>;

/** Result of parsing a PreTeXt string into editor state. */
export interface ParsedPtx {
  /**
   * The XML declaration (`<?xml ... ?>`) from the top of the input, if any.
   * The editor cannot represent it (it is not an element), so we capture it
   * here and `serializeEditorJson` re-prepends it. Without this, every save
   * would strip the declaration — which the round-trip guard would then
   * (correctly) flag on every ordinary PreTeXt file.
   */
  xmlDecl: string | null;
  /**
   * The cleaned XML actually handed to the TipTap parser: declaration
   * stripped, wrapped in `<ptxdoc>`, unknown tags wrapped in `<rawptx>`.
   */
  cleanedXml: string;
  /** The TipTap/ProseMirror document JSON produced by parsing `cleanedXml`. */
  json: EditorJson;
}

/**
 * Parse a PreTeXt XML string into TipTap editor JSON.
 *
 * This is the exact parse the live editor performs (same `cleanPtx`
 * preprocessing, same extension list), factored out so the guard and the
 * tests can run it headlessly. VisualEditor.tsx also feeds the returned
 * `json` straight into `editor.commands.setContent`, which guarantees the
 * editor holds precisely the state the guard verified — no second parse
 * that could diverge.
 *
 * Throws if the input is not well-formed XML (`cleanPtx`'s parser throws);
 * `checkRoundTrip` catches that and reports it as an unsafe document.
 */
export function parsePtx(ptx: string): ParsedPtx {
  // Capture the XML declaration before cleaning. cleanPtx also strips it,
  // but discards it; we need to keep it for serialization.
  let xmlDecl: string | null = null;
  const trimmed = ptx.trim();
  if (trimmed.startsWith("<?xml")) {
    const end = trimmed.indexOf("?>");
    if (end !== -1) {
      xmlDecl = trimmed.slice(0, end + 2);
    }
  }
  const cleanedXml = cleanPtx(ptx);
  // generateJSON runs TipTap's HTML parsing (DOMParser + the ProseMirror
  // schema built from our extensions) without instantiating an editor or
  // touching React node views. It is the headless twin of
  // `editor.commands.setContent(cleanedXml)`.
  const json = generateJSON(cleanedXml, editorExtensions) as EditorJson;
  return { xmlDecl, cleanedXml, json };
}

/**
 * Serialize TipTap editor JSON back to formatted PreTeXt XML.
 *
 * This is the write-back path: `json2ptx` turns the ProseMirror document
 * into PreTeXt tags, `formatPretext` normalizes the result, and the XML
 * declaration captured at parse time (if any) is restored on top.
 *
 * VisualEditor.tsx calls this from `onUpdate`, and `roundTripPtx` calls it
 * to complete the parse→serialize loop, so what the guard checks is
 * byte-for-byte the same function the editor saves with.
 */
export function serializeEditorJson(
  json: EditorJson,
  xmlDecl: string | null = null,
): string {
  // json2ptx expects the raw TipTap JSON tree; its output has ad-hoc
  // newlines around block tags, which formatPretext normalizes away.
  // inlineNodeNames (derived from the schema above) tells it which nodes
  // must be serialized inline instead. The double cast bridges our opaque
  // EditorJson to json2ptx's structural JsonNode type — both describe the
  // same generateJSON/getJSON output.
  const ptx = formatPretext(
    json2ptx(
      json as unknown as Parameters<typeof json2ptx>[0],
      inlineNodeNames,
    ),
  );
  // formatPretext separates a declaration from the root element with a
  // blank line; we match that convention so a round-tripped document is
  // byte-identical to `formatPretext(original)`.
  return xmlDecl ? `${xmlDecl}\n\n${ptx}` : ptx;
}

/**
 * Run a full editor round-trip on a PreTeXt string: parse it exactly as the
 * editor would, then serialize it exactly as a save would. No editing in
 * between — so for a lossless document the result equals
 * `formatPretext(input)`.
 *
 * Exposed primarily for the test harness; `checkRoundTrip` wraps it with
 * error handling and the comparison.
 */
export function roundTripPtx(ptx: string): string {
  const { xmlDecl, json } = parsePtx(ptx);
  return serializeEditorJson(json, xmlDecl);
}

/** Verdict returned by {@link checkRoundTrip}. */
export interface RoundTripReport {
  /**
   * true  → the document survives parse+serialize unchanged (modulo
   *         formatting); editing can be enabled with confidence.
   * false → the round-trip alters the document (or the document could not
   *         be processed at all); the editor must stay read-only.
   */
  safe: boolean;
  /**
   * Human-readable explanation when `safe` is false. Shown to the user in
   * the VisualEditor warning banner.
   */
  reason?: string;
  /**
   * `formatPretext(input)` — what an untouched save *should* produce.
   * Present whenever the comparison ran (i.e. parsing succeeded).
   */
  expected?: string;
  /**
   * The actual round-trip output. Diffing `expected` vs `actual` pinpoints
   * exactly which construct was lost; the test harness prints both on
   * failure for the same reason.
   */
  actual?: string;
  /**
   * The parse result, when parsing succeeded — returned so the caller
   * (VisualEditor) can reuse it for `setContent` instead of parsing the
   * document a second time. This both saves work and guarantees the state
   * loaded into the editor is the state the guard verified.
   */
  parsed?: ParsedPtx;
}

/**
 * The runtime safety guard.
 *
 * Answers: "if the user opens this document and immediately saves without
 * editing, is the file unchanged (apart from formatting)?" If not, some
 * construct in the document is outside the subset the editor can faithfully
 * represent, and enabling WYSIWYG editing would corrupt it.
 *
 * Never throws — every failure mode is folded into `{ safe: false }`:
 *  - malformed XML (cleanPtx's parser throws),
 *  - anything unexpected inside TipTap parsing,
 *  - a round-trip result that differs from `formatPretext(input)`.
 *
 * Cost note: this performs one cleanPtx pass, one ProseMirror parse, one
 * serialize, and two formatPretext runs. For typical section-sized files
 * this is a few milliseconds; callers should still avoid running it more
 * often than content actually changes (VisualEditor runs it only on
 * external content updates, which are already debounced upstream).
 */
export function checkRoundTrip(ptx: string): RoundTripReport {
  // An empty (or whitespace-only) document is trivially safe: there is
  // nothing to lose. This is also the initial state of the VS Code webview
  // before the first "load" message arrives.
  if (!ptx.trim()) {
    return { safe: true };
  }

  // What a formatting-only rewrite of the input looks like. formatPretext
  // never throws (it returns its input on parse failure), so this is safe
  // to compute before we know the document parses.
  const expected = formatPretext(ptx);

  let parsed: ParsedPtx;
  let actual: string;
  try {
    parsed = parsePtx(ptx);
    actual = serializeEditorJson(parsed.json, parsed.xmlDecl);
  } catch (error) {
    // Typically: input is not well-formed XML, so cleanPtx's fromXml threw.
    // (A schema-invalid-but-well-formed document does NOT land here — it
    // parses fine and fails the comparison below instead.)
    return {
      safe: false,
      reason:
        "The document could not be parsed by the visual editor" +
        (error instanceof Error ? `: ${error.message}` : "."),
      expected,
    };
  }

  if (actual === expected) {
    return { safe: true, expected, actual, parsed };
  }

  // The round-trip changed the document. We don't try to classify *what*
  // was lost (the gaps test suite documents the known cases); we just
  // refuse to edit. `expected`/`actual` are returned so a caller or a
  // debugging session can diff them.
  return {
    safe: false,
    reason:
      "This document contains PreTeXt constructs the visual editor cannot " +
      "yet edit without losing content, so editing is disabled.",
    expected,
    actual,
    parsed,
  };
}
