import { ExtensionContext, commands, window, workspace } from "vscode";
import {
  PretextDocumentOutlineProvider,
  cmdOutlineJumpToLine,
} from "./documentOutline";
import {
  PretextTargetsProvider,
  cmdRevealTargetDefinition,
} from "./targetsView";
import { resetProjectList } from "./project";
import { pretextOutputChannel } from "./ui-core";

/**
 * The Outline and Targets views and the commands that drive them, shared by
 * the desktop and browser entry points. Both views read the project through
 * `workspace.fs`, so they work on any workspace VS Code can open. The build
 * and view buttons on a target row need the CLI; extension.ts registers those
 * and the manifest hides them on the web.
 *
 * The providers are returned (and both `activate`s return them as the
 * extension's exports) so the integration tests can read the trees back.
 */
export interface ProjectViews {
  outline: PretextDocumentOutlineProvider;
  targets: PretextTargetsProvider;
}

export function registerProjectViews(context: ExtensionContext): ProjectViews {
  const targets = new PretextTargetsProvider();
  const outline = new PretextDocumentOutlineProvider(context);

  const refreshViews = async ({ silent }: { silent: boolean }) => {
    await resetProjectList({ silent });
    targets.refresh();
    outline.refresh();
  };

  // Keep both views in sync with project.ptx.
  const manifestWatcher = workspace.createFileSystemWatcher("**/project.ptx");
  const onManifestChange = () => refreshViews({ silent: true });

  context.subscriptions.push(
    outline,
    window.registerTreeDataProvider("pretextDocumentOutline", outline),
    window.registerTreeDataProvider("pretextTargets", targets),
    commands.registerCommand(
      "pretext-tools.outlineJumpToLine",
      cmdOutlineJumpToLine,
    ),
    commands.registerCommand("pretext-tools.refreshOutline", () =>
      outline.refresh(),
    ),
    commands.registerCommand("pretext-tools.outlineScopeProject", () =>
      outline.setScope("project"),
    ),
    commands.registerCommand("pretext-tools.outlineScopeFile", () =>
      outline.setScope("file"),
    ),
    commands.registerCommand("pretext-tools.refreshTargets", () => {
      pretextOutputChannel.appendLine("Refreshing project/target list.");
      return refreshViews({ silent: false });
    }),
    commands.registerCommand(
      "pretext-tools.revealTargetDefinition",
      cmdRevealTargetDefinition,
    ),
    manifestWatcher,
    manifestWatcher.onDidChange(onManifestChange),
    manifestWatcher.onDidCreate(onManifestChange),
    manifestWatcher.onDidDelete(onManifestChange),
  );

  return { outline, targets };
}
