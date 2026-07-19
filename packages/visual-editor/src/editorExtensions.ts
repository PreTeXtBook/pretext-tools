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
import { Extension, Node, getSchema } from "@tiptap/core";
import { Focus, Gapcursor, UndoRedo } from "@tiptap/extensions";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";

import { tt2ptx } from "./json2ptx";
import Divisions from "./extensions/Divisions";
import Inline from "./extensions/Inline";
import Blocks from "./extensions/Blocks";
import Title from "./extensions/Title";
import Definition from "./extensions/Definition";
import Url from "./extensions/Url";
import RawPtx, { RawPtxInline } from "./extensions/RawPtx";
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
 * The base extension list (nodes, marks, and editor behaviors), BEFORE the
 * attribute-preservation extension is layered on top.
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
// NOTE: TipTap's CodeBlock extension is deliberately NOT in this list. Its
// only parse rule claims <pre> — a real PreTeXt element — but the resulting
// node serialized as <codeBlock>, corrupting the document. Without it,
// <pre> is simply "unknown" and travels through the rawptx escape hatch
// verbatim. If <pre> is ever modeled for real, it needs a node that
// serializes back to <pre> and preserves interior whitespace exactly.
const baseExtensions = [
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
  RawPtxInline,
  MathInline,
  MathEquation,
  MathDisplay,
  Focus.configure({ mode: "deepest" }),
  UndoRedo,
  Gapcursor,
];

// ─── Source-attribute preservation ───────────────────────────────────────────

/**
 * Node types that must NOT capture source attributes:
 *  - ptxFragment / ptxdoc are synthetic wrappers that never exist in the
 *    author's source;
 *  - text / hardBreak are leaves with no attributes;
 *  - rawptx / rawptxInline are the escape hatches — their "attributes" are
 *    whatever is inside the wrapped source TEXT, never on the wrapper
 *    element itself (cleanPtx always creates them attribute-less).
 */
const ATTRIBUTE_EXEMPT_TYPES = new Set([
  "ptxFragment",
  "ptxdoc",
  "text",
  "hardBreak",
  "rawptx",
  "rawptxInline",
]);

/**
 * The schema built from the base extensions — introspected below to derive
 * (a) which node types carry the ptxAttrs record and (b) which source tags
 * the editor can represent at all. Deriving both from the real schema means
 * neither can drift when extensions are added or removed.
 */
const baseSchema = getSchema(baseExtensions);

/**
 * Every schema node type that should carry a `ptxAttrs` record, derived from
 * the ACTUAL schema built from baseExtensions — so adding a new element
 * extension automatically opts it into attribute preservation; there is no
 * second list to keep in sync.
 */
const attributeCarryingTypes = Object.values(baseSchema.nodes)
  .map((type) => type.name)
  .filter((name) => !ATTRIBUTE_EXEMPT_TYPES.has(name));

/**
 * Node types that do not correspond to any PreTeXt source tag:
 * ptxFragment/text/hardBreak are structural, and the rawptx wrappers are
 * synthetic (a literal <rawptx> in someone's source is NOT ours and should
 * itself be wrapped, not parsed).
 */
const NON_SOURCE_TYPES = new Set([
  "ptxFragment",
  "text",
  "hardBreak",
  "rawptx",
  "rawptxInline",
]);

/**
 * The set of source tags the editor schema can genuinely represent — every
 * node and mark, translated to its PreTeXt tag name (tt2ptx maps the
 * TipTap-native names: bulletList→ul etc.).
 *
 * This is what cleanPtx's "known tags" list MUST equal: a tag listed as
 * known but missing from the schema gets destroyed by the parser instead of
 * being safely rawptx-wrapped (that bug shipped four times: conclusion,
 * part, worksheet, pre). KNOWN_TAGS in knownTags.ts stays a static list so
 * utils.ts needn't import this module (which would be circular — the
 * extension files import utils.ts), and a test in roundtrip.spec.ts asserts
 * the two sets are identical, so any drift fails CI.
 */
export const editorSourceTags: ReadonlySet<string> = new Set(
  [
    ...Object.values(baseSchema.nodes).map((type) => type.name),
    ...Object.values(baseSchema.marks).map((type) => type.name),
  ]
    .filter((name) => !NON_SOURCE_TYPES.has(name))
    .map((name) =>
      name in tt2ptx ? tt2ptx[name as keyof typeof tt2ptx] : name,
    ),
);

/**
 * Attributes that must never be treated as PreTeXt source attributes.
 * These appear on elements when TipTap parses its OWN rendered DOM (most
 * notably on copy/paste inside the editor, where the clipboard HTML is the
 * rendered view: `<article class="theorem …" ptxtag="theorem">`). PreTeXt
 * source never uses class/style, so filtering these is lossless; without
 * the filter a paste would smuggle presentation attributes into the saved
 * document.
 */
const NON_SOURCE_ATTRIBUTES = new Set([
  "class",
  "style",
  "ptxtag",
  "draggable",
  "contenteditable",
  "spellcheck",
  "tabindex",
]);

/**
 * The attribute-preservation extension — the generic replacement for the
 * old per-node whitelists (label/xml:id/component on some blocks, nothing
 * at all on divisions and paragraphs, which silently DROPPED xml:id and
 * broke every xref pointing at them).
 *
 * One catch-all attribute, `ptxAttrs`, is declared on every element-backed
 * node type. At parse time it captures the element's complete attribute
 * record (in source order); json2ptx expands it back into ` key="value"`
 * pairs (XML-escaped) on save, and renderHTML spreads it onto the rendered
 * DOM so ids and the like survive copy/paste inside the editor too.
 *
 * ProseMirror requires attribute names to be declared up front per node
 * type, which is why this is one object-valued attribute rather than
 * individual attributes per name.
 */
const PtxSourceAttributes = Extension.create({
  name: "ptxSourceAttributes",

  addGlobalAttributes() {
    return [
      {
        types: attributeCarryingTypes,
        attributes: {
          ptxAttrs: {
            default: null,
            // A split (pressing Enter inside a paragraph) must NOT copy the
            // attributes onto the new half — that would duplicate xml:ids.
            keepOnSplit: false,
            parseHTML: (element) => {
              const attrs: Record<string, string> = {};
              for (const attr of Array.from(element.attributes)) {
                if (
                  NON_SOURCE_ATTRIBUTES.has(attr.name) ||
                  attr.name.startsWith("data-")
                ) {
                  continue;
                }
                attrs[attr.name] = attr.value;
              }
              return Object.keys(attrs).length > 0 ? attrs : null;
            },
            renderHTML: (attributes) =>
              (attributes.ptxAttrs as Record<string, string> | null) ?? {},
          },
        },
      },
    ];
  },
});

/**
 * The full, canonical extension list: base nodes/marks plus attribute
 * preservation. This is what the live editor, the guard, and the tests all
 * consume.
 */
export const editorExtensions = [...baseExtensions, PtxSourceAttributes];

export default editorExtensions;
