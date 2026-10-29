import { Disposable, TextDocument, Uri, languages, workspace } from "vscode";
import { exists } from "./workspace-fs";

/**
 * Opt-in "takeover" of plain LaTeX/Markdown documents by the PreTeXt flavor
 * languages. Files matching `*.ptx.tex` / `*.ptx.md` get the flavor language
 * directly from the manifest's filenamePatterns; this module handles ordinary
 * `.tex` / `.md` files, which VS Code opens as `latex`/`markdown`, switching
 * them to the flavor language when the corresponding setting is enabled and
 * the workspace is a PreTeXt project.
 */

interface TakeoverRule {
  /** Built-in language ids this rule can take over. */
  sourceLanguages: string[];
  /** The flavor language id to switch matching documents to. */
  targetLanguage: string;
  /** Setting (under `pretext-tools.`) gating the takeover; default false. */
  setting: string;
}

const TAKEOVER_RULES: TakeoverRule[] = [
  {
    sourceLanguages: ["latex", "tex"],
    targetLanguage: "pretext-latex",
    setting: "latexPretext.treatTexAsPretext",
  },
  {
    sourceLanguages: ["markdown"],
    targetLanguage: "pretext-markdown",
    setting: "markdownPretext.treatMarkdownAsPretext",
  },
];

/**
 * Start watching for documents to take over. Also sweeps documents already
 * open at activation time (VS Code fires no onDidOpenTextDocument for those).
 */
export function registerFlavorTakeover(): Disposable {
  for (const document of workspace.textDocuments) {
    void maybeTakeOver(document);
  }
  return workspace.onDidOpenTextDocument((document) => {
    void maybeTakeOver(document);
  });
}

async function maybeTakeOver(document: TextDocument): Promise<void> {
  const rule = TAKEOVER_RULES.find((r) =>
    r.sourceLanguages.includes(document.languageId),
  );
  if (!rule) {
    return;
  }
  if (!(await shouldTakeOver(document, rule))) {
    return;
  }
  await languages.setTextDocumentLanguage(document, rule.targetLanguage);
}

/**
 * Decide whether `document` should be switched to `rule.targetLanguage`.
 *
 * Policy: take over only when
 *   1. the document is a real file (local `file:` or a virtual workspace's
 *      `vscode-vfs:` on the web host; not untitled, git:, output:, ...),
 *   2. the `pretext-tools.<rule.setting>` setting is enabled, and
 *   3. the document lives in a workspace folder whose **root** contains a
 *      `project.ptx` manifest — a deliberately strict check so ordinary LaTeX
 *      or Markdown files in unrelated folders are never hijacked.
 *
 * The check is a single `workspace.fs.stat` per opened document, cheap enough
 * to run each time (avoiding a cache that could go stale when a `project.ptx`
 * is added or removed mid-session). It goes through `workspace.fs` rather than
 * Node's `fs` so the same code runs in the browser bundle.
 */
async function shouldTakeOver(
  document: TextDocument,
  rule: TakeoverRule,
): Promise<boolean> {
  if (!FILE_SCHEMES.has(document.uri.scheme)) {
    return false;
  }
  const enabled = workspace
    .getConfiguration("pretext-tools")
    .get<boolean>(rule.setting, false);
  if (!enabled) {
    return false;
  }
  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return false;
  }
  return exists(Uri.joinPath(folder.uri, "project.ptx"));
}

/** URI schemes under which a document counts as a project file. */
const FILE_SCHEMES = new Set(["file", "vscode-vfs"]);
