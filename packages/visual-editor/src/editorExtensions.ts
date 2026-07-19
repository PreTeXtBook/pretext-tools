/**
 * The canonical TipTap extension list for the PreTeXt visual editor.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the editor schema. It is
 * consumed by three different clients, all of which must agree exactly:
 *
 *   1. `components/VisualEditor.tsx` — the live editor instance.
 *   2. `roundtrip.ts` — the headless parser used by the round-trip safety
 *      guard (`checkRoundTrip`) and by `ptxToEditorJson`.
 *   3. `roundtrip.spec.ts` / `roundtrip.gaps.spec.ts` — the round-trip test
 *      harness.
 *
 * If the live editor and the guard were built from *different* extension
 * lists, the guard could approve a document that the real editor then
 * mangles (or vice versa). Keeping one exported array makes that divergence
 * impossible, so: never construct an ad-hoc extension list elsewhere —
 * import this one.
 */
import { Node } from "@tiptap/core";
import { Focus, Gapcursor, UndoRedo } from "@tiptap/extensions";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import CodeBlock from "@tiptap/extension-code-block";

import Divisions from "./extensions/Divisions";
import Inline from "./extensions/Inline";
import Blocks from "./extensions/Blocks";
import Title from "./extensions/Title";
import Definition from "./extensions/Definition";
import Url from "./extensions/Url";
import RawPtx from "./extensions/RawPtx";
import { MathDisplay, MathEquation, MathInline } from "./extensions/Math";

/**
 * The ProseMirror top-level document node.
 *
 * Incoming PreTeXt is always wrapped in a synthetic `<ptxdoc>` element by
 * `cleanPtx` (see utils.ts) so that arbitrary fragments — a whole
 * `<article>`, a single modular `<section>` file, or a handful of loose
 * paragraphs — all parse under one uniform root. The topNode therefore
 * contains exactly one `ptxdoc` child.
 */
const Document = Node.create({
  name: "ptxFragment",
  topNode: true,
  content: "ptxdoc",
});

/**
 * TipTap's stock OrderedList declares the HTML attributes `start` and
 * `type`, with `start` defaulting to 1. json2ptx faithfully serializes node
 * attributes, so an untouched `<ol>` came back as `<ol start="1">` — a
 * round-trip mutation the guard rightly rejected. PreTeXt's <ol> has no
 * such attributes, so we declare none. (ProseMirror silently ignores
 * attempts to set undeclared attributes, so TipTap's `1. ` input rule
 * still works; it just can't record a custom start number.)
 */
const PtxOrderedList = OrderedList.extend({
  addAttributes() {
    return {};
  },
});

/**
 * The full extension list.
 *
 * Order note: TipTap resolves parse-rule priority partly by extension order,
 * so this array should be treated as ordered. It intentionally mirrors the
 * list that previously lived inline in VisualEditor.tsx (it was moved here
 * verbatim so the round-trip guard could share it).
 *
 * `Focus`, `UndoRedo`, and `Gapcursor` are editor-behavior extensions with
 * no schema contribution; they are harmless in headless parsing contexts
 * (generateJSON only consults the schema/parse rules), so we keep one list
 * rather than maintaining separate "schema" and "editor" lists that could
 * drift apart.
 */
export const editorExtensions = [
  CodeBlock.configure({
    defaultLanguage: "xml",
  }),
  Document,
  Inline,
  Blocks,
  BulletList,
  PtxOrderedList,
  ListItem,
  Divisions,
  Title,
  Definition,
  Url,
  RawPtx,
  MathInline,
  MathEquation,
  MathDisplay,
  Focus.configure({ mode: "deepest" }),
  UndoRedo,
  Gapcursor,
];

export default editorExtensions;
