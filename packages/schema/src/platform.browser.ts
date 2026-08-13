/**
 * A posix-only, filesystem-free stand-in for platform.ts, substituted for it
 * when this package is built for the browser (see vite.config.mts).
 *
 * book.ts and xinclude.ts resolve `xi:include` hrefs and document URIs
 * against each other, never against a real filesystem, so posix path
 * semantics are enough regardless of host OS. `readFileUtf8` has no
 * filesystem to read from at all: a browser host must supply its own
 * `readFile` to `resolveXIncludes`/`collectBookReferences` rather than rely
 * on `defaultFileReader()`.
 */

export function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

function normalize(path: string): string {
  const isAbs = isAbsolute(path);
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!isAbs) {
        parts.push("..");
      }
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join("/");
  return isAbs ? `/${joined}` : joined || ".";
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) {
    return path.startsWith("/") ? "/" : ".";
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

/**
 * Resolve right-to-left until an absolute segment is found, as `path.resolve`
 * does — except rooted at `/` rather than a process cwd, since a virtual path
 * has no cwd to be relative to.
 */
export function resolve(...segments: string[]): string {
  let resolved = "";
  for (let i = segments.length - 1; i >= 0; i -= 1) {
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
  return normalize(resolved);
}

/** Approximates Node's `url.fileURLToPath` using the standard `URL` API. */
export function fileURLToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}

/** Approximates Node's `url.pathToFileURL` using the standard `URL` API. */
export function pathToFileURL(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return `file://${absolute.split("/").map(encodeURIComponent).join("/")}`;
}

export function readFileUtf8(_absolutePath: string): string | undefined {
  throw new Error(
    "@pretextbook/schema: no filesystem in the browser build; pass your own " +
      "`readFile` to resolveXIncludes/collectBookReferences instead of " +
      "relying on defaultFileReader().",
  );
}
