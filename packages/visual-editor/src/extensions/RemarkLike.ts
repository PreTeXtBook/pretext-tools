import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TheoremLikeComponent } from "../components/TheoremLike";
import { generateInputRules } from "../utils";

const RemarkLikeElements = [
  "convention",
  "insight",
  "note",
  "observation",
  "remark",
  "warning",
];

const RemarkLike = Extension.create({
  name: "remarkLike",

  addExtensions() {
    return RemarkLikeElements.map((element) =>
      Node.create({
        name: element,
        content: "title? BasicBlock+",
        group: "block remarkLike",
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
              { class: `${element} remark-like`, label: element },
              HTMLAttributes,
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
      }),
    );
  },
});

export default RemarkLike;

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
