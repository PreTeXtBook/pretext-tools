import {
  Extension,
  Node,
  mergeAttributes,
  wrappingInputRule,
} from "@tiptap/core";

const PtxDoc = Node.create({
  name: "ptxdoc",

  content: "title? (BasicBlock|block|rawptx|division)*",

  group: "root",

  selectable: false,
  draggable: false,

  defining: false,

  parseHTML() {
    return [
      {
        tag: "ptxdoc",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ class: "ptxdoc", ptxtag: "ptxdoc" }, HTMLAttributes),
      0,
    ];
  },
});

const Introduction = Node.create({
  name: "introduction",

  content: "(BasicBlock|block|rawptx)*",

  group: "division introduction",

  selectable: true,
  draggable: true,

  defining: false,

  parseHTML() {
    return [
      {
        tag: "introduction",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "article",
      mergeAttributes(
        { class: "introduction", label: "introduction" },
        HTMLAttributes
      ),
      0,
    ];
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: new RegExp(`^#intro\\s$`),
        type: this.type,
      }),
    ];
  },
});

const Chapter = Node.create({
  name: "chapter",

  content: "title ((introduction?|section+)|(BasicBlock|block|rawptx)+)",

  group: "division",

  selectable: true,

  draggable: true,

  defining: false,

  parseHTML() {
    return [
      {
        tag: "chapter",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      mergeAttributes({ class: "chapter", ptxtag: "chapter" }, HTMLAttributes),
      0,
    ];
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: new RegExp(`^#ch\\s$`),
        type: this.type,
      }),
    ];
  },
});
const Section = Node.create({
  name: "section",
  content: "title ((introduction?|subsection+)|(BasicBlock|block|rawptx)+)",
  group: "division",
  selectable: true,
  draggable: true,
  defining: false,
  parseHTML() {
    return [
      {
        tag: "section",
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      mergeAttributes({ class: "section", ptxtag: "section" }, HTMLAttributes),
      0,
    ];
  },
  addInputRules() {
    return [
      wrappingInputRule({
        find: new RegExp(`^#sec\\s$`),
        type: this.type,
      }),
    ];
  },
});

const Subsection = Node.create({
  name: "subsection",
  content: "title (BasicBlock|block|rawptx)+",
  group: "division",
  selectable: false,
  draggable: true,
  defining: false,
  parseHTML() {
    return [
      {
        tag: "subsection",
      },
    ];
  },
  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("label"),
      },
      "xml:id": {
        parseHTML: (element) => element.getAttribute("xml:id"),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      mergeAttributes(
        { class: "subsection", ptxtag: "subsection" },
        HTMLAttributes
      ),
      0,
    ];
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: new RegExp(`^#subsec\\s$`),
        type: this.type,
      }),
    ];
  },
});

const Divisions = Extension.create({
  name: "divisions",

  addExtensions() {
    return [PtxDoc, Introduction, Chapter, Section, Subsection];
  },
});

export default Divisions;
