import { workspace } from "vscode";
import type { LanguageClientOptions } from "vscode-languageclient";

/**
 * Client options common to the Node and browser hosts.
 *
 * The selector is by language only, with no `scheme` filter: on the web host
 * files are `vscode-vfs:` (github.dev) rather than `file:`, and a `file`-only
 * selector would silently attach the server to nothing.
 */
export function clientOptions(): LanguageClientOptions {
  return {
    // Register the server for PreTeXt documents in all authoring flavors.
    documentSelector: [
      { language: "pretext" },
      { language: "pretext-latex" },
      { language: "pretext-markdown" },
    ],
    synchronize: {
      // Notify the server about file changes to project.ptx files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/project.ptx"),
    },
    //markdown: { isTrusted: true },
  };
}
