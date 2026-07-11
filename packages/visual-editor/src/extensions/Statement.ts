import { Node } from "@tiptap/core";
import { generateInputRules } from "../utils";

const Statement = Node.create({
  name: "statement",
  content: "BasicBlock+",
  group: "blockContent",
  parseHTML() {
    return [{ tag: "statement" }];
  },
  renderHTML() {
    return ["div", { class: "statement", ptxtag: "statement" }, 0];
  },
  addInputRules() {
    return generateInputRules("statement", this.type);
  },
});

export default Statement;
