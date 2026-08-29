/**
 * What pandoc will read on our behalf.
 *
 * These tables mirror `PANDOC_EXTENSIONS` / `PANDOC_BINARY_FORMATS` in the
 * pretext-plus-build server (`app.py`). Keeping a copy here is deliberate: the
 * upload step has to decide what to put in the file picker's `accept` list
 * *before* any request is made, and it should reject a file the server would
 * only 400 on. Drift is therefore possible — if the server's allowlist grows,
 * add the extension here too.
 */

/** Pandoc reader name, as the server's `from` field expects it. */
export type PandocInputFormat = string;

/**
 * Extension → pandoc reader. The server infers the same mapping from an
 * upload's filename, so sending `from` is technically redundant; we send it
 * anyway so an unmappable extension fails here, with a message naming the
 * file, rather than as an opaque 400.
 */
export const PANDOC_EXTENSION_FORMATS: Record<string, PandocInputFormat> = {
  ".docx": "docx",
  ".odt": "odt",
  ".epub": "epub",
  ".tex": "latex",
  ".ltx": "latex",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".rst": "rst",
  ".org": "org",
  ".ipynb": "ipynb",
  ".typ": "typst",
  ".xml": "docbook",
  ".textile": "textile",
};

/** Formats that are zip containers: they must travel as a file upload. */
export const PANDOC_BINARY_FORMATS = new Set(["docx", "odt", "epub"]);

/**
 * Extensions offered in the pandoc engine's file picker.
 *
 * `.xml` is mapped above but deliberately absent here: the server reads `.xml`
 * as DocBook, while in a PreTeXt tool an `.xml` upload is almost always PreTeXt
 * — which the built-in engine already handles correctly and losslessly. A user
 * who really has DocBook can still rename it or pass an explicit `from`.
 *
 * Archives are absent too: the endpoint converts exactly one file, and the
 * built-in engine is the one that unpacks projects.
 */
export const PANDOC_ACCEPT_EXTENSIONS = [
  ".docx",
  ".odt",
  ".epub",
  ".html",
  ".htm",
  ".rst",
  ".org",
  ".ipynb",
  ".typ",
  ".textile",
  ".tex",
  ".ltx",
  ".md",
  ".markdown",
];

/** The extension of `fileName`, lowercased, including the dot. `""` if none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/**
 * The pandoc reader for an uploaded file, or `undefined` when its extension
 * names no format we accept.
 */
export function pandocFormatForFileName(
  fileName: string,
): PandocInputFormat | undefined {
  return PANDOC_EXTENSION_FORMATS[fileExtension(fileName)];
}
