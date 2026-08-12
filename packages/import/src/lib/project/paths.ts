// Pure, browser-safe path helpers. The import pipeline runs in the browser
// (pretext-plus, the VS Code webview) as well as in Node, so it cannot use
// `node:path`; every path it handles is a POSIX-style relative path inside an
// uploaded archive.

/** Normalize separators, drop a leading `./`, and collapse `.`/`..` segments. */
export function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  const isAbsolute = slashed.startsWith("/");
  const out: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // A `..` that escapes the archive root has nowhere to go; keep it so the
      // path stays visibly unresolvable rather than silently rebasing.
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!isAbsolute) {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

/** The directory part of a path (`""` for a bare filename). */
export function dirname(pathName: string): string {
  const slash = pathName.lastIndexOf("/");
  return slash >= 0 ? pathName.slice(0, slash) : "";
}

/** The final segment of a path. */
export function basename(pathName: string): string {
  return pathName.split("/").pop() ?? pathName;
}

/** Lowercased extension without the dot (`""` when there is none). */
export function extension(pathName: string): string {
  const match = basename(pathName)
    .toLowerCase()
    .match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

/** A basename with its extension removed. */
export function stem(pathName: string): string {
  return basename(pathName).replace(/\.[^.]+$/, "");
}

/** Join path segments and normalize the result; empty segments are ignored. */
export function joinPath(...parts: Array<string | undefined | null>): string {
  return normalizePath(parts.filter((p): p is string => !!p).join("/"));
}

/**
 * Re-express `pathName` relative to `base`, when it lives inside it. Used to
 * turn archive paths (`my-book-main/source/main.ptx`) into project-relative
 * ones (`source/main.ptx`). Returns `pathName` unchanged when it is outside
 * `base`.
 */
export function relativeToDirectory(base: string, pathName: string): string {
  if (!base) {
    return pathName;
  }
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return pathName.startsWith(prefix) ? pathName.slice(prefix.length) : pathName;
}
