import { FileType, Uri, workspace } from "vscode";

/**
 * The few `workspace.fs` idioms the host-neutral code shares, in one place.
 *
 * Everything on the extension host reads through `workspace.fs` so that it
 * works the same on disk and in a virtual workspace (github.dev). The same
 * three questions come up everywhere — is this there, what size and date is
 * this file, what does this file say — and each has a wrinkle worth fixing
 * only once: a stat that throws means "not there", a directory is not a
 * file, and on the web host the extension's own files are served over
 * http(s), which `workspace.fs` has no provider for but `fetch` can read.
 */

/** True when something (file or directory) exists at `uri`. */
export async function exists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** A file's stat, or undefined when it is missing or not a file. */
export async function statFile(
  uri: Uri,
): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const stat = await workspace.fs.stat(uri);
    if (!(stat.type & FileType.File)) {
      return undefined;
    }
    return { mtimeMs: stat.mtime, size: stat.size };
  } catch {
    return undefined;
  }
}

/**
 * The bytes of a file, or undefined when it cannot be read. An http(s) URI
 * with no file system provider (the extension's own assets on the web host)
 * is fetched instead.
 */
export async function readFileBytes(uri: Uri): Promise<Uint8Array | undefined> {
  try {
    return await workspace.fs.readFile(uri);
  } catch {
    if (uri.scheme !== "http" && uri.scheme !== "https") {
      return undefined;
    }
  }
  try {
    const response = await fetch(uri.toString(true));
    return response.ok
      ? new Uint8Array(await response.arrayBuffer())
      : undefined;
  } catch {
    return undefined;
  }
}

/** {@link readFileBytes}, decoded as UTF-8. */
export async function readFileText(uri: Uri): Promise<string | undefined> {
  const bytes = await readFileBytes(uri);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}
