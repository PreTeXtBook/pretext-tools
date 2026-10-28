import { ExtensionContext, Uri, workspace } from "vscode";
import type { LanguageClientOptions } from "vscode-languageclient";

/**
 * Client options common to the Node and browser hosts.
 *
 * The selector is by language only, with no `scheme` filter: on the web host
 * files are `vscode-vfs:` (github.dev) rather than `file:`, and a `file`-only
 * selector would silently attach the server to nothing.
 *
 * `initializationOptions.assetsUri` tells the server where the bundled schema
 * assets are; it reads them back through `pretext/readFile` (see
 * project-sync.ts), since a Web Worker has no filesystem.
 */
export function clientOptions(
  context: ExtensionContext,
): LanguageClientOptions {
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
    initializationOptions: {
      assetsUri: Uri.joinPath(
        context.extensionUri,
        "assets",
        "schema",
      ).toString(),
    },
    //markdown: { isTrusted: true },
  };
}
