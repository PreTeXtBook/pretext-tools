import { Disposable, Uri, workspace } from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { readFileText } from "../workspace-fs";

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
/**
 * Build output and the like: never part of the source tree. The directory
 * names are listed once and spelled into a `findFiles` exclude glob for the
 * snapshot; the watchers cannot take an exclude, so their events are
 * filtered against the same names ({@link isExcluded}).
 */
const EXCLUDED_DIRS = ["node_modules", ".git", "output", "generated"];
const EXCLUDE = `{${EXCLUDED_DIRS.map((dir) => `**/${dir}/**`).join(",")}}`;
/** Caps so a stray giant workspace cannot stall startup. */
const MAX_TEXT_FILES = 4000;
const MAX_NAMED_FILES = 10000;
/** How many files are read at once while taking the snapshot. */
const READ_CONCURRENCY = 32;

interface ProjectFileEntry {
  uri: string;
  text?: string;
}

/** True when `uri` lies under one of {@link EXCLUDED_DIRS}. */
export function isExcluded(uri: Uri): boolean {
  return uri.path
    .split("/")
    .slice(0, -1)
    .some((segment) => EXCLUDED_DIRS.includes(segment));
}

/**
 * `Promise.all` with at most {@link READ_CONCURRENCY} tasks in flight. A
 * snapshot of thousands of files over a remote file system (github.dev)
 * would otherwise issue every read at once.
 */
async function mapLimited<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker),
  );
  return results;
}

async function collectProjectFiles(): Promise<ProjectFileEntry[]> {
  const [textFiles, namedFiles] = await Promise.all([
    workspace.findFiles(TEXT_GLOB, EXCLUDE, MAX_TEXT_FILES),
    workspace.findFiles(NAMED_GLOB, EXCLUDE, MAX_NAMED_FILES),
  ]);
  const entries: ProjectFileEntry[] = await mapLimited(
    textFiles,
    async (uri) => ({
      uri: uri.toString(),
      text: await readFileText(uri),
    }),
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
      (await readFileText(Uri.parse(uri))) ?? null,
  );

  // A watcher has no exclude, so a `pretext build` writing under output/
  // would otherwise push every file it makes into the snapshot.
  const notify = (uri: Uri, change: { text?: string; deleted?: boolean }) => {
    if (isExcluded(uri)) {
      return;
    }
    client.sendNotification("pretext/projectFileChanged", {
      uri: uri.toString(),
      ...change,
    });
  };
  const textWatcher = workspace.createFileSystemWatcher(TEXT_GLOB);
  const namedWatcher = workspace.createFileSystemWatcher(NAMED_GLOB);
  const onTextChanged = async (uri: Uri) => {
    if (isExcluded(uri)) {
      return;
    }
    notify(uri, { text: await readFileText(uri) });
  };
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
