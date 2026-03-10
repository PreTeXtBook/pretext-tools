import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TheoremLikeComponent } from "../components/TheoremLike";
import { generateInputRules } from "../utils";

const AxiomLikeElements = [
  "assumption",
  "axiom",
  "conjecture",
  "heuristic",
  "hypothesis",
  "principle",
];

const AxiomLike = Extension.create({
  name: "axiomLike",

  addExtensions() {
    const array = [];
    for (const element of AxiomLikeElements) {
      array.push(
        Node.create({
          name: element,
          content: "title? statement",
          group: "block axiomLike",
          selectable: true,
          draggable: true,
          parseHTML() {
            return [
              {
                tag: element,
              },
            ];
          },
          renderHTML({ HTMLAttributes }) {
            return [
              "article",
              mergeAttributes(
                { class: `${element} axiom-like`, label: element },
                HTMLAttributes
              ),
              0,
            ];
          },
          addNodeView() {
            return ReactNodeViewRenderer(TheoremLikeComponent);
          },
          addInputRules() {
            return generateInputRules(element, this.type);
          },
        })
      );
    }

    return array;
  },
});

export default AxiomLike;

//addCommands() {
//  return {
//    [`set${element.charAt(0).toUpperCase() + element.slice(1)}`]:
//      (attributes: Record<string, any>) =>
//        ({
//          commands,
//        }: {
//          commands: {
//            setWrap: (
//              name: string,
//              attributes: Record<string, any>
//            ) => boolean;
//          };
//        }) => {
//          return commands.setWrap(this.name, attributes);
//        },
// [`toggle${element.charAt(0).toUpperCase() + element.slice(1)}`]: (attributes: Record<string, any>) =>
//   ({ commands }: { commands: { toggleWrap: (name: string, attributes: Record<string, any>) => boolean } }) => {
//     return commands.toggleWrap(this.name, attributes)
//   },
//  };
//},
