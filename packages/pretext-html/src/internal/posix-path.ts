/**
 * A posix-only stand-in for `node:path`, substituted for it when this package
 * is built for the browser (see vite.config.ts).
 *
 * This is safe because none of the paths this package computes ever reach a
 * real filesystem: libxslt-wasm is compiled with FILESYSTEM=0, so every path
 * ends up as either a key in the mount table or a segment of a
 * `*.ptx.invalid` URL (see mounts.ts). They are virtual paths, and virtual
 * paths are posix paths — a browser caller passes `sourcePath: "/main.ptx"`
 * and means exactly what it says.
 *
 * Only the handful of functions this package actually uses are implemented.
 */

export const sep = "/";

/**
 * Collapse `.` and `..` segments. An absolute path clamps at the root
 * (`/a/../../b` → `/b`), which is what makes the containment checks in
 * mounts.ts and xinclude.ts safe against `..` traversal.
 */
export function normalize(p: string): string {
  if (!p) {
    return ".";
  }
  const isAbsolute = p.startsWith("/");
  const hadTrailingSlash = p.length > 1 && p.endsWith("/");
  const parts: string[] = [];
  for (const segment of p.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      const last = parts[parts.length - 1];
      if (parts.length > 0 && last !== "..") {
        parts.pop();
      } else if (!isAbsolute) {
        parts.push("..");
      }
      // An absolute path clamps: `..` above the root is dropped.
      continue;
    }
    parts.push(segment);
  }
  let out = parts.join("/");
  if (isAbsolute) {
    out = `/${out}`;
  }
  if (!out) {
    return isAbsolute ? "/" : ".";
  }
  if (hadTrailingSlash && !out.endsWith("/")) {
    out += "/";
  }
  return out;
}

/**
 * Resolve right-to-left until an absolute path is found. With no absolute
 * segment the result is rooted at `/` rather than at a process cwd — there is
 * no cwd in a browser, and a virtual path is meaningless relative to one.
 */
export function resolve(...segments: string[]): string {
  let resolved = "";
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }
    resolved = resolved ? `${segment}/${resolved}` : segment;
    if (segment.startsWith("/")) {
      break;
    }
  }
  if (!resolved.startsWith("/")) {
    resolved = `/${resolved}`;
  }
  const normalized = normalize(resolved);
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

export function join(...segments: string[]): string {
  const joined = segments.filter(Boolean).join("/");
  return joined ? normalize(joined) : ".";
}

export function dirname(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  // `p` was the root (or all slashes): stripping left nothing, but the parent
  // of "/" is "/".
  if (!trimmed) {
    return p.startsWith("/") ? "/" : ".";
  }
  const index = trimmed.lastIndexOf("/");
  if (index < 0) {
    return ".";
  }
  if (index === 0) {
    return "/";
  }
  return trimmed.slice(0, index);
}

export function relative(from: string, to: string): string {
  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1;
  }
  const up = new Array<string>(fromParts.length - shared).fill("..");
  return [...up, ...toParts.slice(shared)].join("/");
}

/**
 * `path.posix` self-reference: on posix, `path` and `path.posix` are the same
 * thing, and call sites that reach for `path.posix.normalize` to be explicit
 * should keep working.
 */
export const posix = { sep, normalize, resolve, join, dirname, relative };

export default { sep, normalize, resolve, join, dirname, relative, posix };
