/**
 * Retargeting the asset URLs PreTeXt emits.
 *
 * A portable build inlines `latex-image` and `prefigure` SVGs directly into
 * the page (pretext-html.xsl, mode="svg-embedded"), so those need nothing from
 * us — they are read at transform time through the fetch shim. Everything else
 * — author-supplied images and media, sageplot, asymptote — is emitted as a
 * *runtime* URL under one of two fixed prefixes:
 *
 *     <img src="external/kitten.png">
 *     <img src="generated/sageplot/plot.svg">
 *
 * Those prefixes (`$external-directory` / `$generated-directory` in
 * publisher-variables.xsl) name directories a real build populates by copying
 * files next to the output HTML. The preview has no output directory, so the
 * URLs dangle and the assets silently fail to load.
 *
 * The prefixes are hardcoded rather than derived from the publication file,
 * which is what makes retargeting reliable: find them, and hand each path to a
 * host that knows how to serve it — `Webview.asWebviewUri` under VS Code, a
 * blob or hosted URL in a browser. Mapping the prefix back to a real directory
 * needs the publication file's `@external`/`@generated`, which the renderer
 * reports as {@link RenderResult.assetDirs}.
 */

/** Which of PreTeXt's two asset directories a URL points into. */
export type AssetKind = "external" | "generated";

// Placeholders for assets that are not there, re-exported so a host needs a
// single import to both find asset URLs and stand in for the broken ones.
export {
  describeAsset,
  missingAssetPlaceholder,
  missingAssetSvg,
} from "./missing-asset.js";
export type { MissingAsset } from "./missing-asset.js";

/**
 * Maps one asset path to a URL the host can actually load.
 *
 * `relPath` is percent-decoded and relative to the directory `kind` names
 * (e.g. `"kitten.png"`, `"sageplot/plot.svg"`). Return `undefined` to leave
 * the URL untouched — appropriate when the file does not exist, so the page
 * keeps PreTeXt's own broken-image markup rather than pointing at a URL that
 * will 404 anyway.
 */
export type AssetUrlResolver = (
  kind: AssetKind,
  relPath: string,
) => string | undefined;

/**
 * Matches the `src` of an element pointing into one of the two asset
 * directories. The opening quote is part of the match, so a prefix that merely
 * *contains* "external/" (an absolute CDN URL, say) cannot match.
 *
 * Only `src` for now. Archive download links (`href`) and `<object data>` use
 * the same prefixes and can be folded in by widening the attribute group,
 * once the mechanism has proven itself on the common cases.
 */
const ASSET_URL = /\bsrc="(external|generated)\/([^"]*)"/g;

/** Escape a URL for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Percent-decode an emitted path. The stylesheets encode spaces (see the
 * `str:replace` calls in publisher-variables.xsl), and a resolver joining onto
 * a filesystem path needs the literal name back. Malformed encodings are left
 * as-is rather than throwing.
 */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Rewrite every `external/`- or `generated/`-prefixed asset URL in `html`
 * through `resolve`. Paths the resolver declines are left untouched.
 */
export function rewriteAssetUrls(
  html: string,
  resolve: AssetUrlResolver,
): string {
  return html.replace(ASSET_URL, (match, kind: AssetKind, rest: string) => {
    const resolved = resolve(kind, decodePath(rest));
    return resolved === undefined
      ? match
      : `src="${escapeAttribute(resolved)}"`;
  });
}
