# Box-Edit (for PreTeXt)

The visual editor for PreTeXt

# @pretextbook/visual-editor

A React-based visual editor for PreTeXt documents using TipTap and ProseMirror.

## Features

- **TipTap Extensions**: Custom TipTap extensions for PreTeXt elements (divisions, theorems, definitions, etc.)
- **React Components**: Reusable React components for building visual editors
- **Dual Build Modes**:
  - Library mode for use in other packages
  - Webview mode for VS Code extension integration

## Installation

```bash
npm install @pretextbook/visual-editor
```

## Usage as a Library

### Importing Components

```typescript
import { VisualEditor, MenuBar, BubbleMenu } from "@pretextbook/visual-editor";
import "@pretextbook/visual-editor/styles";
```

### Importing TipTap Extensions

```typescript
import {
  Divisions,
  Blocks,
  Inline,
  Title,
  TheoremLike,
  Definition,
  MathInline,
  MathEquation,
  KeyboardCommands,
} from "@pretextbook/visual-editor";

// Use in your TipTap editor
const editor = useEditor({
  extensions: [
    Divisions,
    Blocks,
    Inline,
    Title,
    // ... other extensions
  ],
  content: yourContent,
});
```

### Utilities

```typescript
import { json2ptx, cleanPtx, knownTags } from "@pretextbook/visual-editor";

// Convert TipTap JSON to PreTeXt XML
const ptxXml = json2ptx(editorJson);

// Clean PreTeXt source
const cleanedPtx = cleanPtx(rawPtx);
```

## Development

### Build Commands

- `npm run build:lib` - Build the library for use in other packages
- `npm run build:webview` - Build the webview for VS Code extension
- `npm run build:all` - Build both library and webview versions
- `npm run dev` - Start development server
- `npm run watch` - Watch mode for development

## Architecture

This package exports:

- **TipTap Extensions**: Custom node and mark types for PreTeXt elements
- **React Components**: UI components for the visual editor
- **Utilities**: Helper functions for converting between formats

## Dependencies

- React 18+
- TipTap 3.14+
- KaTeX for math rendering

## License

See LICENSE file in the repository root.

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ["./tsconfig.node.json", "./tsconfig.app.json"],
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from "eslint-plugin-react-x";
import reactDom from "eslint-plugin-react-dom";

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    "react-x": reactX,
    "react-dom": reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs["recommended-typescript"].rules,
    ...reactDom.configs.recommended.rules,
  },
});
```
