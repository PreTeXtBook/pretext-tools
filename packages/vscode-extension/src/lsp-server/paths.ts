import path from 'path';

/**
 * Directory containing the bundled schema assets (RELAX NG grammars and the
 * precompiled grammar JSON). Kept in its own module so that importing it does
 * not drag in `main.ts`, which starts the LSP server as an import side effect.
 */
export const schemaDir = path.join(__dirname, '..', 'assets', 'schema');
