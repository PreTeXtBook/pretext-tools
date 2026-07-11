/* eslint-disable @typescript-eslint/no-explicit-any */
interface CursorPosition {
  pos: () => number;
  depth: () => number;
  inTextNode: () => boolean;
  prevNodeIsText: () => boolean;
  nextNodeIsText: () => boolean;
  parentType: () => string;
  anchor: () => any; // Replace `any` with the appropriate type if known
  nextNodeSize: () => number;
  prevNodeSize: () => number;
}

interface Editor {
  $pos: (pos: number) => any; // Replace `any` with the appropriate type if known
  state: {
    selection: {
      $anchor: {
        pos: number;
        depth: number;
        parent: {
          firstChild: { isText: boolean } | null;
          type: { name: string };
        };
        nodeBefore: { isText: boolean; nodeSize: number } | null;
        nodeAfter: { type: { name: string }; nodeSize: number } | null;
      };
    };
  };
}

export const getCursorPos = (editor: Editor): CursorPosition => {
  //const currentPos = editor.$pos(editor.state.selection.$anchor.pos);
  return {
    pos: () => {
      return editor.state.selection.$anchor.pos;
    },
    depth: () => {
      return editor.state.selection.$anchor.depth;
    },
    inTextNode: () => {
      return editor.state.selection.$anchor.parent.firstChild
        ? editor.state.selection.$anchor.parent.firstChild.isText
        : false;
    },
    prevNodeIsText: () => {
      return editor.state.selection.$anchor.nodeBefore
        ? editor.state.selection.$anchor.nodeBefore.isText
        : false;
    },
    nextNodeIsText: () => {
      return editor.state.selection.$anchor.nodeAfter
        ? editor.state.selection.$anchor.nodeAfter.type.name === "text"
        : false;
    },
    parentType: () => {
      return editor.state.selection.$anchor.parent.type.name;
    },
    anchor: () => {
      return editor.state.selection.$anchor;
    },
    nextNodeSize: () => {
      return editor.state.selection.$anchor.nodeAfter
        ? editor.state.selection.$anchor.nodeAfter.nodeSize
        : 0;
    },
    prevNodeSize: () => {
      return editor.state.selection.$anchor.nodeBefore
        ? editor.state.selection.$anchor.nodeBefore.nodeSize
        : 0;
    },
  };
};
