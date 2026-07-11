import { Node, mergeAttributes } from "@tiptap/core";

/*
 * This is a special Tiptap node that is used to represent raw PreTeXt source.
 * A preprocessor (cleanPtx) parses incoming PreTeXt xml and wraps unknown tags
 * with <rawptx>.  This node renders the rawptx as a <pre> block, and is used to
 * display the raw PreTeXt source in the visual editor.
 */
const RawPtx = Node.create({
  name: "rawptx",

  content: "text*",

  marks: "",

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

export default RawPtx;
