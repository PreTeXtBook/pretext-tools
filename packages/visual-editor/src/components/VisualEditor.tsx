import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import "katex/dist/katex.min.css";
import "../styles.scss";
import "./VisualEditor.css";
//import { MenuBar } from "./TiptapMenuBar";
import { PtxBubbleMenu } from "./BubbleMenu";
//import { PtxFloatingMenu } from "./FloatingMenu";
//import { getCursorPos } from "../extensions/getCursorPos";

// The TipTap extension list lives in its own module so that the live editor,
// the round-trip guard, and the round-trip test harness all build the SAME
// ProseMirror schema. Do not add extensions inline here — add them to
// editorExtensions.ts so the guard stays in sync with what the editor does.
import { editorExtensions } from "../editorExtensions";

// checkRoundTrip is the safety guard: it verifies that parsing this document
// into the editor and serializing it straight back out reproduces the
// document (modulo formatting). serializeEditorJson is the matching
// write-back path (json2ptx + formatPretext + XML-declaration restore).
// See roundtrip.ts for the full contract.
import {
  checkRoundTrip,
  serializeEditorJson,
  type RoundTripReport,
} from "../roundtrip";

/**
 * Banner shown instead of the Edit toggle when the round-trip guard
 * determined that this document cannot be edited without data loss.
 * This is the "safe refusal" half of the guard: rather than silently
 * corrupting unsupported constructs, we keep the view read-only and say why.
 */
const RoundTripWarning = ({ report }: { report: RoundTripReport }) => {
  if (report.safe) {
    return null;
  }
  return (
    <div className="pretext-plus-editor__roundtrip-warning" role="alert">
      <p>
        <strong>Editing disabled:</strong>{" "}
        {report.reason ||
          "This document cannot be safely edited by the visual editor."}
      </p>
    </div>
  );
};

//const InfoMessage = ({ editor }: { editor: Editor }) => {
//  const [cursorInfo, setCursorInfo] = useState({
//    pos: 0,
//    parentType: "",
//    depth: 0,
//    prevNodeIsText: false,
//    nextNodeIsText: false,
//    prevNodeSize: 0,
//    nextNodeSize: 0,
//    inTextNode: false,
//    location: "",
//    parentTypeAlt: "",
//  });

//  useEffect(() => {
//    if (!editor) return;

//    const updateCursorInfo = () => {
//      const cursor = getCursorPos(editor);
//      const altCursor = editor.state.selection.$anchor;
//      const location = `Line: ${altCursor.start()} Column: ${altCursor.parentOffset}`;
//      setCursorInfo({
//        pos: cursor.pos(),
//        parentType: cursor.parentType(),
//        depth: cursor.depth(),
//        prevNodeIsText: cursor.prevNodeIsText(),
//        nextNodeIsText: cursor.nextNodeIsText(),
//        prevNodeSize: cursor.prevNodeSize(),
//        nextNodeSize: cursor.nextNodeSize(),
//        inTextNode: cursor.inTextNode(),
//        location,
//        parentTypeAlt: altCursor.parent.type.name,
//      });
//    };

//    updateCursorInfo();

//    editor.on("selectionUpdate", updateCursorInfo);

//    return () => {
//      editor.off("selectionUpdate", updateCursorInfo);
//    };
//  }, [editor]);

//  return (
//    <div className="info">
//      <p>Debugging Info:</p>
//      <ul>
//        <li>Position: {cursorInfo.pos}</li>
//        <li>Parent Type: {cursorInfo.parentType}</li>
//        <li>Depth: {cursorInfo.depth}</li>
//        <li>Node before is text? {cursorInfo.prevNodeIsText ? "Yes" : "No"}</li>
//        <li>Node after is text? {cursorInfo.nextNodeIsText ? "Yes" : "No"}</li>
//        <li>Previous node size: {cursorInfo.prevNodeSize}</li>
//        <li>Next node size: {cursorInfo.nextNodeSize}</li>
//        <li>In text node? {cursorInfo.inTextNode ? "Yes" : "No"}</li>
//        <li>Location: {cursorInfo.location}</li>
//        <li>Parent type: {cursorInfo.parentTypeAlt}</li>
//      </ul>
//    </div>
//  );
//};

interface VisualEditorProps {
  /** PreTeXt XML string to render and (optionally) edit. */
  content: string;
  /**
   * Called (debounced 500 ms) with updated PreTeXt XML whenever the user edits
   * content. Only fired when editing is enabled.
   */
  onChange: (html: string) => void;
  /**
   * Whether editing is allowed. Defaults to `true`.
   * When `false`, the editor stays read-only and the "Edit" toggle is hidden.
   */
  canEdit?: boolean;
  /**
   * Message shown when editing is disabled.
   */
  editDisabledReason?: string;
}

const VisualEditor = ({
  content,
  onChange,
  canEdit = true,
  editDisabledReason,
}: VisualEditorProps) => {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditableRef = useRef(false);
  const [isEditable, setIsEditable] = useState(false);

  /**
   * Verdict from the round-trip guard for the current content prop.
   *
   * This is DERIVED state (a pure function of `content`), so it lives in a
   * useMemo rather than in state set from an effect. Editing is only ever
   * enabled while `guardReport.safe` is true; when it is false the Edit
   * toggle is disabled and RoundTripWarning explains why.
   *
   * Note this also re-runs on the echo of our own onChange output (the host
   * writes the document and sends it back). That is intentional: it
   * re-verifies after every save that the on-disk text still round-trips,
   * so any serializer instability fails closed (editing disables) instead
   * of compounding.
   */
  const guardReport: RoundTripReport = useMemo(
    () => checkRoundTrip(content),
    [content],
  );

  /**
   * The XML declaration (`<?xml ... ?>`) of the current document, captured
   * by the guard's parse. ProseMirror cannot represent it, so we carry it
   * outside the editor state and serializeEditorJson re-prepends it on
   * every save. A ref (not state) because it never affects rendering.
   */
  const xmlDeclRef = useRef<string | null>(null);

  // Editing requires all three: the host allows it (canEdit), the user asked
  // for it (the Edit checkbox), and the guard proved it is safe.
  const isEditingEnabled = canEdit && isEditable && guardReport.safe;

  const editor = useEditor({
    extensions: editorExtensions,
    // No initial content on purpose: ALL content flows through the guarded
    // effect below, which is the single place documents are parsed and
    // loaded. (Previously the raw, un-cleaned XML was passed here and then
    // immediately replaced by the cleaned version — the raw parse could
    // trip onContentError and wrongly disable the editor.)
    content: undefined,
    onContentError(props) {
      // Defense in depth: with enableContentCheck the editor rejects content
      // that violates the schema. The guard should catch problem documents
      // before they get here, but if something slips through we still fail
      // closed rather than corrupting.
      console.error("Visual editor content error:", props.error);
      props.disableCollaboration();
      props.editor.setEditable(false, false);
    },
    enableContentCheck: true,
    onUpdate: ({ editor }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (isEditableRef.current) {
          // Serialize through the same function the round-trip guard
          // verified (json2ptx + formatPretext), restoring the document's
          // XML declaration so a save never strips it.
          onChange(serializeEditorJson(editor.getJSON(), xmlDeclRef.current));
        }
      }, 500);
    },
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Distinguishes genuinely external content changes (open, edits made in
  // the text editor, host echo) from the prop change caused by our own
  // onChange call, so we don't reload the editor — and lose the cursor —
  // in response to our own output.
  const isExternalUpdateRef = useRef(true);

  /**
   * The single content-loading path.
   *
   * Whenever external content arrives (and the change is not the echo of
   * our own edit), load the guard's parse result into the editor. We reuse
   * `guardReport.parsed.json` instead of handing the XML string to
   * setContent, which (a) avoids parsing the document twice and (b)
   * guarantees the editor holds EXACTLY the state the guard verified —
   * there is no second parse that could diverge from the verdict.
   *
   * setContent cannot fail here: the JSON was produced by generateJSON
   * against the very same schema moments earlier (see parsePtx in
   * roundtrip.ts), so it is schema-valid by construction.
   *
   * Note that an unsafe-but-parseable document is still displayed
   * (read-only): the lossy parse is a perfectly good *preview*; it is only
   * dangerous to write back. A document that failed to parse at all clears
   * the view so a stale previous document isn't shown under the banner.
   */
  useEffect(() => {
    if (!editor || !isExternalUpdateRef.current) {
      return;
    }
    // Remember the document's XML declaration for save time (see onUpdate).
    xmlDeclRef.current = guardReport.parsed?.xmlDecl ?? null;
    if (guardReport.parsed) {
      editor.commands.setContent(guardReport.parsed.json, {
        emitUpdate: false,
      });
    } else {
      editor.commands.clearContent(false);
    }
  }, [guardReport, editor]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      isExternalUpdateRef.current = false;
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor]);

  useEffect(() => {
    isExternalUpdateRef.current = true;
  }, [content]);

  useEffect(() => {
    isEditableRef.current = isEditingEnabled;
    if (editor) {
      editor.setEditable(isEditingEnabled, false);
    }
  }, [editor, isEditingEnabled]);

  return (
    <div className="pretext-plus-editor__visual-editor">
      <div className="pretext-plus-editor__visual-editor-header">
        <p className="pretext-plus-editor__visual-editor-title">
          Simple Preview
        </p>
        {canEdit ? (
          <label className="pretext-plus-editor__edit-toggle">
            <input
              className="pretext-plus-editor__edit-checkbox"
              type="checkbox"
              checked={isEditable && guardReport.safe}
              // The toggle is disabled (not hidden) when the guard failed, so
              // the affordance is discoverable but unusable; the banner below
              // explains why.
              disabled={!guardReport.safe}
              onChange={() => setIsEditable(!isEditable)}
            />
            Edit
          </label>
        ) : (
          <p className="pretext-plus-editor__visual-editor-hint">
            {editDisabledReason || "Read-only preview"}
          </p>
        )}
      </div>
      {/* Round-trip guard verdict: visible only when editing had to be
          disabled to avoid data loss. See roundtrip.ts for how the verdict
          is computed. */}
      {canEdit ? <RoundTripWarning report={guardReport} /> : null}
      <div
        className={(isEditingEnabled ? "editable" : "read-only") + " ptx-page"}
      >
        {/* <MenuBar editor={editor} /> */}
        <EditorContent editor={editor} />
      </div>
      {canEdit ? <PtxBubbleMenu editor={editor} /> : null}
      {/*<InfoMessage editor={editor} />*/}
    </div>
  );
};

export default VisualEditor;
