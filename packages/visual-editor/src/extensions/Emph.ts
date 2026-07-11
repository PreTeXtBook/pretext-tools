import { Node, mergeAttributes } from "@tiptap/core";

export const inputPTXRegex = /(?:^|\s)(<em>(.*?)<\/em>)$/;
export const pastePTXRegex = /(?:^|\s)(<em>(.*?)<\/em>)/g;

export const inputMDRegex = /(?:^|\s)(\*(.*?)\*)$/;
export const inputRegex = /(?:^|\s)`em\s$/;

// /(?:^|\s)(`(?!\s+`)((?:[^`]+))`(?!\s+`))$/

const Emphasis = Node.create({
  name: "em",
  content: "text*",
  inline: true,
  group: "inline",

  parseHTML() {
    return [{ tag: "em" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "em" }, HTMLAttributes), 0];
  },
});
// The following works, but since we will have so many, we probably just want to use the toggleMark('term') command directly.
// addCommands() {
//   return {
//     setTerm: () => ({ commands }) => {
//       return commands.setMark(this.name)
//     },
//     toggleTerm: () => ({ commands }) => {
//       return commands.toggleMark(this.name)
//     },
//     unsetTerm: () => ({ commands }) => {
//       return commands.unsetMark(this.name)
//     },
//   }
// },

// addKeyboardShortcuts() {
//   return {
//     'Mod-d': () => this.editor.commands.toggleTerm()
//   }
// },

export default Emphasis;
