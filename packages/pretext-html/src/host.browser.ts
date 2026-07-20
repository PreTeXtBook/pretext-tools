/**
 * Browser implementation of the platform seam (see host.ts for the contract
 * and host.node's counterpart). Substituted for `./host.js` when this package
 * is built for the browser; vite.config.ts wires the alias.
 *
 * There is no filesystem here, so:
 *
 *  - Mount roots are base URLs rather than directories, and `readMount` is a
 *    `fetch`. Containment is enforced by resolving against the base and
 *    checking the result still sits under it.
 *  - `readSource` can only read things that are actually addressable, i.e.
 *    absolute URLs. A browser caller naming a virtual path (`/main.ptx`) gets
 *    `undefined`, which means **`sourceContent` is effectively required** and
 *    `xi:include`s cannot be resolved from disk. Pre-resolve includes, or
 *    pass the merged document as `sourceContent`.
 *  - `assetsBase()` defaults to the version-pinned jsDelivr copy of this
 *    package, so an embedder needs no build configuration at all. Call
 *    `setAssetsBase()` to self-host.
 */

/** Injected by vite.config.ts from package.json at build time. */
declare const __PKG_VERSION__: string;

const DEFAULT_ASSETS_BASE = `https://cdn.jsdelivr.net/npm/@pretextbook/pretext-html@${__PKG_VERSION__}/assets`;

let assetsBaseOverride: string | undefined;

/**
 * Serve this package's `assets/` from somewhere other than jsDelivr — a
 * self-hosted copy, an offline bundle, a same-origin path. Must be called
 * before the first render; the compiled stylesheet is cached per root.
 */
export function setAssetsBase(base: string): void {
  assetsBaseOverride = base.replace(/\/+$/, "");
}

export function assetsBase(): string {
  return assetsBaseOverride ?? DEFAULT_ASSETS_BASE;
}

export function joinPath(root: string, child: string): string {
  return `${root.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

// ── XSL bundle ──────────────────────────────────────────────────────────────
// A cold render pulls ~31 files out of the XSL mount (13 stylesheets, plus
// localizations.xml and the 17 locale files that pretext-common.xsl eagerly
// loads via `document($locale-files)`). Over a CDN that is ~31 latency-bound
// round trips, each one suspending the WASM stack. assets/xsl-bundle.json is
// a single pre-recorded map of those files — one request instead of ~31.
// It is an optimisation, never a requirement: a bundle that is missing, stale
// or incomplete just falls through to per-file fetches.

type Bundle = Map<string, string>;

const bundles = new Map<string, Promise<Bundle>>();

function bundleUrlFor(root: string): string {
  // The XSL mount root is `${assetsBase()}/xsl`; the bundle sits beside it.
  return `${root.replace(/\/+$/, "")}-bundle.json`;
}

function loadBundle(root: string): Promise<Bundle> {
  let cached = bundles.get(root);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch(bundleUrlFor(root));
        if (!response.ok) {
          return new Map();
        }
        const raw = (await response.json()) as Record<string, string>;
        return new Map(Object.entries(raw));
      } catch {
        return new Map();
      }
    })();
    bundles.set(root, cached);
  }
  return cached;
}

/**
 * Only the assets XSL root is bundled. Project mounts hold the user's own
 * files, which no shipped bundle can know about; probing them would just cost
 * a 404 per render.
 */
function isBundledRoot(root: string): boolean {
  return root === joinPath(assetsBase(), "xsl");
}

export async function readMount(
  root: string,
  relPath: string,
): Promise<Uint8Array | undefined> {
  if (isBundledRoot(root)) {
    const bundle = await loadBundle(root);
    const hit = bundle.get(relPath.replace(/^\/+/, ""));
    if (hit !== undefined) {
      return new TextEncoder().encode(hit);
    }
  }

  const base = `${root.replace(/\/+$/, "")}/`;
  let target: URL;
  try {
    target = new URL(relPath.replace(/^\/+/, ""), base);
  } catch {
    return undefined;
  }
  // Containment: a `..` in the path must not climb above the mount root.
  if (!target.href.startsWith(base)) {
    console.error(
      `pretext-html: refusing to serve ${relPath} from outside ${root}`,
    );
    return undefined;
  }
  try {
    const response = await fetch(target.href);
    if (!response.ok) {
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

export async function readSource(
  location: string,
): Promise<string | undefined> {
  // Only absolute URLs are readable; a virtual path has nothing behind it.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) {
    return undefined;
  }
  try {
    const response = await fetch(location);
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}
