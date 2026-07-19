import { Node, mergeAttributes } from "@tiptap/core";

/*
 * This is a special Tiptap node that is used to represent raw PreTeXt source.
 * A preprocessor (cleanPtx) parses incoming PreTeXt xml and wraps unknown tags
 * with <rawptx>.  This node renders the rawptx as a <pre> block, and is used to
 * display the raw PreTeXt source in the visual editor.
 *
 * On serialization (json2ptx) the node's text content is emitted verbatim —
 * no <rawptx> tags — so whatever source was wrapped comes back exactly as it
 * went in. This is the block half of the escape hatch; see RawPtxInline below
 * for the inline half.
 */
const RawPtx = Node.create({
  name: "rawptx",

  content: "text*",

  marks: "",

  // Member of both block-ish groups so a wrapped unknown element is legal
  // anywhere ordinary blocks are: "BasicBlock" admits it to statement/proof/
  // hint/answer/solution/remark content (`BasicBlock+`), and "block" admits
  // it to list items (`paragraph block*`). Without these, cleanPtx would
  // wrap an unknown block inside e.g. <statement> and ProseMirror would
  // then reject the wrapper and mangle the content anyway.
  group: "BasicBlock block",

  selectable: true,

  draggable: true,

  defining: true,

  code: true,

  whitespace: "pre",

  parseHTML() {
    return [
      {
        tag: "rawptx",
        preserveWhitespace: "full",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes({ class: "rawptx", ptxtag: "rawptx" }, HTMLAttributes),
      0,
    ];
  },
});

/*
 * Inline counterpart of RawPtx: the escape hatch for unknown elements that
 * live inside a paragraph's text flow (<xref>, <fn>, <q>, <init>, ...).
 *
 * These cannot use the block-level <rawptx> wrapper — a block node is
 * illegal in the paragraph's `inline*` content, and ProseMirror would strip
 * the wrapper and corrupt the text. cleanPtx (utils.ts) therefore wraps
 * unknown elements found in inline context with <rawptx-inline> instead.
 *
 * The node renders as a small inline "chip" (a <code> element styled in
 * styles.scss) showing the raw source, which the user can edit as text.
 * json2ptx emits the chip's text verbatim with no surrounding tags and no
 * injected whitespace, exactly like the block version, so the original
 * markup round-trips unchanged.
 */
const RawPtxInline = Node.create({
  name: "rawptxInline",

  content: "text*",

  // No marks INSIDE the raw source text (its content is code, not prose).
  // Note this does not prevent a surrounding mark (e.g. <em>) from being
  // attached to the chip itself by the paragraph — that case does not yet
  // round-trip and is documented in roundtrip.gaps.spec.ts.
  marks: "",

  group: "inline",

  inline: true,

  selectable: true,

  code: true,

  whitespace: "pre",

  parseHTML() {
    return [
      {
        // The tag cleanPtx writes. A dashed name is used so the HTML parser
        // treats it as a generic custom element and never applies special
        // parsing rules to it.
        tag: "rawptx-inline",
        preserveWhitespace: "full",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "code",
      mergeAttributes(
        { class: "rawptx-inline", ptxtag: "rawptx-inline" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

export default RawPtx;
export { RawPtxInline };
