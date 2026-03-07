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
        tag: "url"
      }
    ];
  },

  addAttributes() {
    return {
      href: {
        parseHTML: (element) => element.getAttribute("href"),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes({ ptxtag: "url" }, HTMLAttributes),
      0,
    ];
  }
});

export default Url;
