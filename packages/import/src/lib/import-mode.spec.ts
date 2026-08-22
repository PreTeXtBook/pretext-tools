import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "./upload";
import {
  DEFAULT_IMPORT_MODE,
  assetsForImportMode,
  filesForImportMode,
  hasNativeImportMode,
  projectForImportMode,
  resolveImportMode,
} from "./import-mode";
import type { ImportedProjectSuccess } from "./types";

const LATEX = `\documentclass{book}
\title{A Book}
\begin{document}
\chapter{One}
Hello.
\end{document}
`;

const MARKDOWN = `# A Book

## One

Hello.
`;

const PRETEXT = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <book xml:id="book">
    <title>A Book</title>
    <chapter xml:id="one">
      <title>One</title>
      <p>Hello.</p>
    </chapter>
  </book>
</pretext>
`;

function importOne(path: string, source: string): ImportedProjectSuccess {
  const result = importProjectFromFiles({ [path]: source });
  if ("pretextError" in result) {
    throw new Error(`import failed: ${result.pretextError}`);
  }
  return result;
}

describe("import mode defaults", () => {
  it("defaults to converting to PreTeXt", () => {
    expect(DEFAULT_IMPORT_MODE).toBe("converted");
  });

  it("offers a native alternative for LaTeX and Markdown", () => {
    expect(hasNativeImportMode(importOne("main.tex", LATEX))).toBe(true);
    expect(hasNativeImportMode(importOne("main.md", MARKDOWN))).toBe(true);
  });

  it("offers no native alternative for PreTeXt input", () => {
    expect(hasNativeImportMode(importOne("main.ptx", PRETEXT))).toBe(false);
  });

  it("resolves a host's preferred mode against what the result carries", () => {
    const latex = importOne("main.tex", LATEX);
    const pretext = importOne("main.ptx", PRETEXT);

    expect(resolveImportMode(latex, "native")).toBe("native");
    expect(resolveImportMode(latex, "converted")).toBe("converted");
    // No native projection to keep, so the preference collapses rather than
    // reporting a mode whose files the host would never write.
    expect(resolveImportMode(pretext, "native")).toBe("converted");
    expect(resolveImportMode(latex)).toBe(DEFAULT_IMPORT_MODE);
  });

  it("selects the matching files, assets, and project for each mode", () => {
    const result = importOne("main.tex", LATEX);

    expect(Object.keys(filesForImportMode(result, "native"))).toContain(
      "source/main.tex",
    );
    expect(Object.keys(filesForImportMode(result, "converted"))).toContain(
      "source/main.ptx",
    );
    expect(assetsForImportMode(result, "converted")).toBe(result.outputAssets);
    expect(assetsForImportMode(result, "native")).toBe(result.assets);
    expect(projectForImportMode(result, "native")).toBe(result.nativeProject);
    expect(projectForImportMode(result, "converted")).toBe(result.project);
  });
});
