import { Node, mergeAttributes } from "@tiptap/core";
import { generateInputRules } from "../utils";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TheoremLikeComponent } from "../components/TheoremLike";

const Definition = Node.create({
  name: "definition",
  content: "title? statement",
  group: "block definitionLike",
  selectable: true,
  draggable: true,
  defining: false,
  // This would make it so an extra delete would not delete the parent node.  Not sure how we would end up deleting it.
  // isolating: true,

  parseHTML() {
    return [
      {
        tag: "definition",
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "article",
      mergeAttributes(
        { class: "definition definition-like", label: "definition" },
        HTMLAttributes,
      ),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TheoremLikeComponent);
  },
  addInputRules() {
    return generateInputRules("definition", this.type);
  },
});

export default Definition;
