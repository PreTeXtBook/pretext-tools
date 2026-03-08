// Main exports for using the visual-editor as a library

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

// Export types if any
export type * from "./knownTags";
