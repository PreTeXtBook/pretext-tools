import { getCursorPos } from "./getCursorPos";
import { Extension } from "@tiptap/core";

const KeyboardCommands = Extension.create({
  name: "keyboardCommands",

  addKeyboardShortcuts() {
    const cursor = getCursorPos(this.editor);
    return {
      "Mod-i": () => {
        console.log(cursor.anchor());
        return true;
      },
      // ArrowLeft moves focus to parent node, unless the cursor is in the middle of a text node, in which case it should just do the "normal" thing.
      ArrowLeft: () => {
        if (cursor.prevNodeIsText()) {
          return false;
        }
        if (cursor.depth() > 0) {
          console.log(cursor.depth());
          this.editor.commands.selectParentNode();
          this.editor.commands.scrollIntoView();
          return true;
        } else {
          this.editor.commands.focus("start", { scrollIntoView: true });
          return true;
        }
      },
      // ArrowRight moves the position of the cursor to the next position, which can be the next text position or the next node.
      ArrowRight: () => {
        this.editor.commands.focus(cursor.pos() + 1, { scrollIntoView: true });
        return true;
      },
      // ArrowDown should move the cursor to the next node at the same depth if on a box.  If in a text node, do the default.
      ArrowDown: () => {
        if (
          cursor.inTextNode() ||
          (cursor.prevNodeSize() === 0 && cursor.nextNodeSize() === 0)
        ) {
          return false;
        } else {
          this.editor.commands.focus(cursor.pos() + cursor.nextNodeSize(), {
            scrollIntoView: true,
          });
          return true;
        }
      },
      // ArrowUp should move the cursor to the start of the previous node at the same depth if on a box.  If in a text node, do the default.
      ArrowUp: () => {
        if (
          cursor.inTextNode() ||
          (cursor.prevNodeSize() === 0 && cursor.nextNodeSize() === 0)
        ) {
          return false;
        } else {
          this.editor.commands.focus(cursor.pos() - cursor.prevNodeSize(), {
            scrollIntoView: true,
          });
          return true;
        }
      },
      // Enter should move the cursor onto the child node if on a box, or add a line break if in a text node.  The second time Enter is pressed inside a text node, directly after a hardBreak, the cursor should create a new text node.
      Enter: () => {
        if (cursor.inTextNode()) {
          if (!cursor.prevNodeIsText() && cursor.prevNodeSize() === 1) {
            const pos = cursor.pos();
            this.editor.commands.splitBlock();
            this.editor.commands.deleteRange({ from: pos - 1, to: pos + 1 });
            // eslint-disable-next-line no-constant-condition
            if (true) return true;
          }
          this.editor.commands.setHardBreak();
          return true;
        } else {
          // Keep the event handled when focused on a node container.
          return true;
          //           this.editor.commands.focus(cursor.pos()+1,true);
          //           return true
        }
      },
      "Mod-q": () => this.editor.commands.blur(),
      // Escape moves focus to parent node.
      Escape: () => this.editor.commands.selectParentNode(),
      "Mod-Right": () => this.editor.commands.selectNodeForward(),
      "Mod-Down": () => this.editor.commands.selectNodeForward(),
      // 'Alt-ArrowUp': () => this.editor.commands.setNodeSelection(currentPos.before ? currentPos.before.pos : currentPos.pos),
      // 'Alt-ArrowDown': () => this.editor.commands.setNodeSelection(currentPos.after ? currentPos.after.pos : currentPos.pos),
    };
  },
});

export default KeyboardCommands;
