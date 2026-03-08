import {
  Extension,
  Node,
  mergeAttributes,
  wrappingInputRule,
} from "@tiptap/core";
import TheoremLike from "./TheoremLike";
import AxiomLike from "./AxiomLike";
import Statement from "./Statement";
import ExampleLike from "./ExampleLike";
import RemarkLike from "./RemarkLike";

const Para = Node.create({
  name: "p",

  content: "inline*",

  group: "BasicBlock paragraph",

  //   selectable: false,

  draggable: true,

  defining: false,
  priority: 1000,

  parseHTML() {
    return [
      {
        tag: "p",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ class: "p", ptxtag: "p" }, HTMLAttributes),
      0,
    ];
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: new RegExp(`^#p\\s$`),
        type: this.type,
      }),
    ];
  },
});

const Blocks = Extension.create({
  name: "blocks",

  addExtensions() {
    return [Para, TheoremLike, ExampleLike, AxiomLike, RemarkLike, Statement];
  },
});

export default Blocks;
