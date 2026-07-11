import { Mark, mergeAttributes } from "@tiptap/core";

// /(?:^|\s)(`(?!\s+`)((?:[^`]+))`(?!\s+`))$/

const UnknownMark = Mark.create({
  name: "unknownMark",

  group: "marks",

  parseHTML() {
    return [{ tag: "unknown" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "unknown" }, HTMLAttributes), 0];
  },
});

export default UnknownMark;
