import { Node, mergeAttributes } from "@tiptap/core";

const Url = Node.create({
  name: "url",
  content: "text*",
  group: "inline",
  inline: true,
  atom: false,

  parseHTML() {
    return [
      {
        tag: "url",
      },
    ];
  },

  // href (and any other source attribute) is captured generically by the
  // PtxSourceAttributes extension in editorExtensions.ts; its renderHTML
  // spreads the captured attributes onto the rendered <a>, so the link
  // still works in the editor view.

  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes({ ptxtag: "url" }, HTMLAttributes), 0];
  },
});

export default Url;
