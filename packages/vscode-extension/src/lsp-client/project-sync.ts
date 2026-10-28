import { Disposable, Uri, workspace } from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";

/**
 * Feed the language server the files it cannot read itself.
 *
 * The server runs without a filesystem (it is a Web Worker on github.dev,
 * and the Node server follows the same contract), so the client:
 *
 *  - answers `pretext/projectFiles` with a snapshot of the workspace's PreTeXt
 *    sources — text for `.ptx`/`.xml`, names only for the other files an
 *    author might reference (images, LaTeX, code) — and keeps it current from
 *    file watchers via `pretext/projectFileChanged`;
 *  - answers `pretext/readFile` for any URI — the bundled schema assets, a
 *    custom schema file — with `workspace.fs`.
 *
 * Register this before `client.start()`; the handlers are queued until the
 * connection exists.
 */

/** Files sent with their text: everything that can hold PreTeXt markup. */
const TEXT_GLOB = "**/*.{ptx,xml}";
/** Files sent by name only, for path completions (`xi:include`, `<image>`, …). */
const NAMED_GLOB =
  "**/*.{png,jpg,jpeg,gif,svg,pdf,tex,asy,py,sage,sagews,sws,css,js,md,txt}";
/** Build output and the like: never part of the source tree. */
const EXCLUDE = "{**/node_modules/**,**/.git/**,**/output/**,**/generated/**}";
/** Caps so a stray giant workspace cannot stall startup. */
const MAX_TEXT_FILES = 4000;
const MAX_NAMED_FILES = 10000;

interface ProjectFileEntry {
  uri: string;
  text?: string;
}

async function readText(uri: Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await workspace.fs.readFile(uri));
  } catch {
    // No file system provider for the scheme. On the web host the
    // extension's own assets are served over http(s), which `fetch` reads.
    if (uri.scheme === "http" || uri.scheme === "https") {
      try {
        const response = await fetch(uri.toString(true));
        return response.ok ? await response.text() : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function collectProjectFiles(): Promise<ProjectFileEntry[]> {
  const [textFiles, namedFiles] = await Promise.all([
    workspace.findFiles(TEXT_GLOB, EXCLUDE, MAX_TEXT_FILES),
    workspace.findFiles(NAMED_GLOB, EXCLUDE, MAX_NAMED_FILES),
  ]);
  const entries: ProjectFileEntry[] = await Promise.all(
    textFiles.map(async (uri) => ({
      uri: uri.toString(),
      text: await readText(uri),
    })),
  );
  for (const uri of namedFiles) {
    entries.push({ uri: uri.toString() });
  }
  return entries;
}

export function registerProjectSync(client: BaseLanguageClient): Disposable {
  client.onRequest("pretext/projectFiles", collectProjectFiles);
  client.onRequest(
    "pretext/readFile",
    async ({ uri }: { uri: string }) =>
      (await readText(Uri.parse(uri))) ?? null,
  );

  const notify = (uri: Uri, change: { text?: string; deleted?: boolean }) =>
    client.sendNotification("pretext/projectFileChanged", {
      uri: uri.toString(),
      ...change,
    });
  const textWatcher = workspace.createFileSystemWatcher(TEXT_GLOB);
  const namedWatcher = workspace.createFileSystemWatcher(NAMED_GLOB);
  const onTextChanged = async (uri: Uri) =>
    notify(uri, { text: await readText(uri) });
  const onDeleted = (uri: Uri) => notify(uri, { deleted: true });

  return Disposable.from(
    textWatcher,
    namedWatcher,
    textWatcher.onDidCreate(onTextChanged),
    textWatcher.onDidChange(onTextChanged),
    textWatcher.onDidDelete(onDeleted),
    namedWatcher.onDidCreate((uri) => notify(uri, {})),
    namedWatcher.onDidDelete(onDeleted),
  );
}
