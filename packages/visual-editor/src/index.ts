// Main exports for using the visual-editor as a library

// Import the VisualEditor component to ensure CSS is bundled
import "./components/VisualEditor";

// Export all TipTap extensions
export { default as AxiomLike } from "./extensions/AxiomLike";
export { default as Blocks } from "./extensions/Blocks";
export { default as Definition } from "./extensions/Definition";
export { default as Divisions } from "./extensions/Divisions";
export { default as Emph } from "./extensions/Emph";
export { default as ExampleLike } from "./extensions/ExampleLike";
export { default as Inline } from "./extensions/Inline";
export { default as KeyboardCommands } from "./extensions/Keyboard";
export { MathDisplay, MathEquation, MathInline } from "./extensions/Math";
export { default as RawPtx } from "./extensions/RawPtx";
export { default as Statement } from "./extensions/Statement";
export { default as TheoremLikeExtension } from "./extensions/TheoremLike";
export { default as Title } from "./extensions/Title";
export { default as UnknownMark } from "./extensions/UnknownMark";
export { default as Url } from "./extensions/Url";
export { getCursorPos } from "./extensions/getCursorPos";

// Export React components
export { PtxBubbleMenu } from "./components/BubbleMenu";
export { PtxFloatingMenu } from "./components/FloatingMenu";
export { default as MenuBar } from "./components/MenuBar";
export type { MenuBarProps } from "./components/MenuBar";
export { TheoremLikeComponent, ProofComponent } from "./components/TheoremLike";
export { default as VisualEditor } from "./components/VisualEditor";

// Export utilities
export { json2ptx } from "./json2ptx";
export { cleanPtx } from "./utils";
export { KNOWN_TAGS } from "./knownTags";

// The canonical extension list shared by the live editor, the round-trip
// guard, and the test harness. External consumers (e.g. pretext.plus) that
// build their own TipTap editor should use this list so their schema matches
// what checkRoundTrip verifies.
export { editorExtensions } from "./editorExtensions";

// Round-trip machinery: parse/serialize helpers plus the checkRoundTrip
// safety guard that decides whether a document can be edited without data
// loss. See roundtrip.ts for the full contract.
export {
  parsePtx,
  serializeEditorJson,
  roundTripPtx,
  checkRoundTrip,
} from "./roundtrip";
export type { ParsedPtx, RoundTripReport, EditorJson } from "./roundtrip";

// Export types if any
export type * from "./knownTags";
