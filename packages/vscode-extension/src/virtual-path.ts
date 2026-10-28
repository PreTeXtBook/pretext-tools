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
 *
 * The virtual path of `scheme://authority/a/b.ptx` is
 * `/__vfs__/scheme/authority/a/b.ptx`. Three kinds of URI need more than
 * that to come back out the same, and are spelled so that path arithmetic
 * (which may collapse `//`) cannot damage them:
 *
 * - an empty authority (`git:`, `untitled:`) is written as `-`, which no
 *   real host can be;
 * - a path with no leading slash (`untitled:Untitled-1`) is marked with an
 *   {@link OPAQUE} segment;
 * - a query or fragment (a `git:` diff document carries its ref as JSON in
 *   the query) is appended percent-encoded, so it holds no separator.
 */

export const VFS_PREFIX = "/__vfs__/";
/** Stands in for an empty authority. */
const NO_AUTHORITY = "-";
/** First segment of a path that had no leading slash. */
const OPAQUE = ".opaque";

export function uriToPath(uri: string): string {
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    return parsed.fsPath;
  }
  const authority = parsed.authority === "" ? NO_AUTHORITY : parsed.authority;
  const path = parsed.path.startsWith("/")
    ? parsed.path
    : `/${OPAQUE}/${parsed.path}`;
  const query = parsed.query ? `?${encodeURIComponent(parsed.query)}` : "";
  const fragment = parsed.fragment
    ? `#${encodeURIComponent(parsed.fragment)}`
    : "";
  return `${VFS_PREFIX}${parsed.scheme}/${authority}${path}${query}${fragment}`;
}

export function pathToUri(absolutePath: string): string {
  // Node's win32 `path.resolve` prefixes a virtual path with the current
  // drive; a virtual path never has one, so strip it before looking.
  const posix = absolutePath
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:(?=\/__vfs__\/)/, "");
  if (!posix.startsWith(VFS_PREFIX)) {
    return URI.file(absolutePath).toString();
  }
  // The query and fragment are percent-encoded, so the first `?` and `#`
  // after the path are the ones uriToPath wrote.
  const match = /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s.exec(
    posix.slice(VFS_PREFIX.length),
  );
  const [, hierarchy = "", query, fragment] = match ?? [];
  const [scheme, authority, ...segments] = hierarchy.split("/");
  const path =
    segments[0] === OPAQUE
      ? segments.slice(1).join("/")
      : `/${segments.join("/")}`;
  return URI.from({
    scheme,
    authority: authority === NO_AUTHORITY ? "" : authority,
    path,
    query: query === undefined ? "" : decodeURIComponent(query),
    fragment: fragment === undefined ? "" : decodeURIComponent(fragment),
  }).toString();
}
