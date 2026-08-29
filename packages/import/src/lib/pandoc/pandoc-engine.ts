/**
 * The half of a pandoc import that is the same everywhere.
 *
 * A pandoc conversion is two steps: get PreTeXt out of pandoc, then lay that
 * PreTeXt out as a project. Only the first step depends on where pandoc runs —
 * a local binary (VS Code's extension host), or the pretext-plus-build
 * `/pandoc/` endpoint. The second step is the same `importProjectFromFiles`
 * call either way, so it lives here and the transport is injected.
 */
import { importProjectFromFiles, type ImportProjectOptions } from "../upload";
import type { ImportEngine } from "../../react/import-wizard";
import type { ImportedProjectResult } from "../types";
import { PANDOC_ACCEPT_EXTENSIONS } from "./formats";

/**
 * Runs pandoc on one uploaded file and resolves with the PreTeXt it produced.
 * Should reject with a message fit to show the user; the wizard's error screen
 * prints it verbatim.
 */
export type PandocBridge = (
  file: File,
  options: ImportProjectOptions,
) => Promise<string>;

export interface PandocEngineOptions {
  /** Where pandoc actually runs. */
  convertToPretext: PandocBridge;
  id?: string;
  label?: string;
  description?: string;
  acceptExtensions?: string[];
}

/**
 * Build an `ImportEngine` from a pandoc transport.
 *
 * The engine implements only `convertFile`, never `prepare`, which is what
 * makes the wizard skip its Sources step: pandoc converts exactly one file, so
 * there is no root to choose and no second format on offer.
 */
export function createPandocEngine(options: PandocEngineOptions): ImportEngine {
  const {
    convertToPretext,
    id = "pandoc",
    label = "Pandoc",
    description = "Convert Word, OpenOffice, EPUB, HTML, reStructuredText, and more.",
    acceptExtensions = PANDOC_ACCEPT_EXTENSIONS,
  } = options;

  return {
    id,
    label,
    description,
    acceptExtensions,
    convertFile: async (
      file: File,
      importOptions: ImportProjectOptions,
    ): Promise<ImportedProjectResult> => {
      const pretext = await convertToPretext(file, importOptions);
      if (!pretext.trim()) {
        throw new Error(
          `Pandoc produced no output for ${file.name}. The file may be empty or in an unexpected format.`,
        );
      }

      // Pandoc hands back one document, so the options that pick *among*
      // uploaded files (mainFile, sourceFormat, attachRoots, assets,
      // preserveProjectLayout) have nothing to act on; only the layout ones
      // are forwarded.
      const result = importProjectFromFiles(
        { "source.ptx": pretext },
        {
          documentKind: importOptions.documentKind,
          splitChapters: importOptions.splitChapters,
          splitSections: importOptions.splitSections,
          splitLevel: importOptions.splitLevel,
        },
      );

      // The review screen should name the file the user actually dropped,
      // not the "source.ptx" we invented to carry pandoc's output.
      if (!("pretextError" in result)) {
        result.sourceName = file.name;
        result.sourcePath = file.name;
      }
      return result;
    },
  };
}
