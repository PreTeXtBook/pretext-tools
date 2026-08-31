// Where author-supplied images land, and making the document's references
// point there (SPEC §3.9).
//
// PreTeXt resolves `<image source="…"/>` against the publication file's
// `<directories external="…"/>`, not against the source file — `source="a.png"`
// becomes `external/a.png` in the built HTML. So an import has two matching
// obligations, and until now met neither: put the files in the directory the
// publication file actually declares, and rewrite the references to match,
// since an uploaded document refers to images by whatever path they had in the
// archive it came from.

import { basename } from "../project/paths";

/**
 * The default `external` directory name, matching what `renderPublicationPtx`
 * writes into the publication file it generates. Relative to the main source
 * file's own directory, which is how PreTeXt reads it.
 */
export const DEFAULT_EXTERNAL_DIR = "external";

/**
 * Where an image lands, given the directory holding the main source file.
 *
 * Paths are flattened to the basename: `@source` is relative to one flat
 * external directory, so the tree the archive happened to use cannot survive.
 */
export function imageAssetPath(
  sourceDir: string,
  externalDir: string,
  fileName: string,
): string {
  const dir = externalDir.replace(/\/+$/, "");
  return dir ? `${sourceDir}${dir}/${fileName}` : `${sourceDir}${fileName}`;
}

export interface RoutedImages {
  /** Output path for each original upload path. */
  pathByOriginal: Record<string, string>;
  /**
   * What each `<image source="…"/>` should become, keyed by the basename the
   * document is most likely to name the image by. Values are relative to the
   * external directory, which is what `@source` means.
   */
  sourceByBaseName: Record<string, string>;
}

/**
 * Decide where every image goes, deduplicating names that collide once the
 * paths are flattened: an archive's `chapters/figs/plot.png` and
 * `appendix/figs/plot.png` are two different images with one name.
 */
export function routeImageAssets(
  originalPaths: readonly string[],
  sourceDir: string,
  externalDir: string = DEFAULT_EXTERNAL_DIR,
): RoutedImages {
  const pathByOriginal: Record<string, string> = {};
  const sourceByBaseName: Record<string, string> = {};
  const taken = new Set<string>();

  for (const originalPath of originalPaths) {
    const base = basename(originalPath);
    let name = base;
    if (taken.has(name)) {
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let n = 2;
      while (taken.has(`${stem}-${n}${ext}`)) {
        n += 1;
      }
      name = `${stem}-${n}${ext}`;
    }
    taken.add(name);
    pathByOriginal[originalPath] = imageAssetPath(sourceDir, externalDir, name);
    // The first image with a given basename wins the bare name, since that is
    // what an unqualified reference in the document most likely means.
    if (!(base in sourceByBaseName)) {
      sourceByBaseName[base] = name;
    }
  }

  return { pathByOriginal, sourceByBaseName };
}

/** Elements whose `@source` names an author-supplied file. */
const SOURCE_ELEMENTS = ["image", "video", "audio"];

const SOURCE_ATTRIBUTE = new RegExp(
  `(<(?:${SOURCE_ELEMENTS.join("|")})\\b[^>]*?\\bsource\\s*=\\s*)(["'])([^"']*)\\2`,
  "g",
);

export interface RewriteImageSourcesResult {
  source: string;
  /** Original → rewritten, for each reference that moved. */
  rewritten: Array<{ from: string; to: string }>;
  /** References naming a file the upload did not carry. */
  unresolved: string[];
}

/**
 * Point every `@source` at the image's new home.
 *
 * Matched by basename rather than by full path: a document says
 * `source="figures/plot.png"` while the archive held it at
 * `chapters/figures/plot.png`, and the basename is the part both agree on. A
 * reference naming a file the upload did not carry is left exactly as written —
 * it may point at something the author will supply later — and reported.
 */
export function rewriteImageSources(
  pretextSource: string,
  sourceByBaseName: Record<string, string>,
): RewriteImageSourcesResult {
  const rewritten: Array<{ from: string; to: string }> = [];
  const unresolved: string[] = [];

  const source = pretextSource.replace(
    SOURCE_ATTRIBUTE,
    (whole, prefix: string, quote: string, value: string) => {
      if (value === "" || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
        return whole; // empty, or an absolute URL the import does not own
      }
      const replacement = sourceByBaseName[basename(value)];
      if (replacement === undefined) {
        unresolved.push(value);
        return whole;
      }
      if (replacement !== value) {
        rewritten.push({ from: value, to: replacement });
      }
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );

  return { source, rewritten, unresolved };
}
