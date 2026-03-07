import { FloatingMenu } from "@tiptap/react/menus";
import { Editor } from "@tiptap/react";
import React, { useEffect } from "react";

export const PtxFloatingMenu = ({ editor }: { editor: Editor }) => {
  const [isEditable] = React.useState(true);
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable);
    }
  }, [isEditable, editor]);
  if (!editor) {
    return null;
  }

  return (
    <>
      {editor && (
        <FloatingMenu
          editor={editor}
          shouldShow={null}
          className="floating-menu"
        >
          <div className="floating-menu" data-testid="floating-menu">
            <button
              onClick={() => editor.chain().focus().setNode("theorem").run()}
              className={editor.isActive("p") ? "is-active" : ""}
            >
              Theorem
            </button>
            <button
              onClick={() => editor.chain().focus().setNode("proof").run()}
              className={editor.isActive("p") ? "is-active" : ""}
            >
              Proof
            </button>
          </div>
        </FloatingMenu>
      )}
    </>
  );
};
