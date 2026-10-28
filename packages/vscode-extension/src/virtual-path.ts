import { URI } from "vscode-uri";

/**
 * The path space shared by the extension host and the language server.
 *
 * The manifest resolver, the project outline, `@pretextbook/schema` and
 * `@pretextbook/completions` all think in absolute paths: an `xi:include`
 * href resolves with path arithmetic against the including file. A `file:`
 * document maps to its ordinary filesystem path. A document under any other
 * scheme — `vscode-vfs:` on github.dev, for instance — maps to a virtual
 * absolute path that encodes the scheme and authority, so the same arithmetic
 * works and the result maps back to the right URI. Nothing here touches the
 * filesystem or `vscode`, so both bundles (and the unit tests) can use it.
 */

export const VFS_PREFIX = "/__vfs__/";

export function uriToPath(uri: string): string {
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    return parsed.fsPath;
  }
  return `${VFS_PREFIX}${parsed.scheme}/${parsed.authority}${parsed.path}`;
}

export function pathToUri(absolutePath: string): string {
  // Node's win32 `path.resolve` prefixes a virtual path with the current
  // drive; a virtual path never has one, so strip it before looking.
  const posix = absolutePath
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:(?=\/__vfs__\/)/, "");
  if (posix.startsWith(VFS_PREFIX)) {
    const [scheme, authority, ...segments] = posix
      .slice(VFS_PREFIX.length)
      .split("/");
    return URI.from({
      scheme,
      authority,
      path: `/${segments.join("/")}`,
    }).toString();
  }
  return URI.file(absolutePath).toString();
}
