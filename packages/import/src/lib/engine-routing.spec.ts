import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCEPT_EXTENSIONS,
  allAcceptExtensions,
  alternateEngine,
  alternateFor,
  engineAccepts,
  matchesExtension,
  routeEngine,
  unsupportedFileMessage,
  type RoutableEngine,
} from "./engine-routing";

const builtin: RoutableEngine = {
  id: "builtin",
  label: "Built-in converter",
  acceptExtensions: [".tex", ".md", ".markdown", ".ptx", ".zip", ".tar.gz"],
};

const pandoc: RoutableEngine = {
  id: "pandoc",
  label: "Pandoc",
  acceptExtensions: [".docx", ".epub", ".html", ".tex", ".md", ".markdown"],
};

const engines = [builtin, pandoc];

describe("matchesExtension", () => {
  it("matches case-insensitively", () => {
    expect(matchesExtension("Paper.TeX", [".tex"])).toBe(true);
  });

  it("matches multi-dot extensions on the whole suffix", () => {
    expect(matchesExtension("book.tar.gz", [".tar.gz"])).toBe(true);
    expect(matchesExtension("book.targz", [".tar.gz"])).toBe(false);
  });

  it("does not match a bare name that merely contains the text", () => {
    expect(matchesExtension("tex-notes", [".tex"])).toBe(false);
  });
});

describe("engineAccepts", () => {
  it("falls back to the built-in set when an engine names no extensions", () => {
    const bare: RoutableEngine = { id: "bare", label: "Bare" };
    for (const extension of DEFAULT_ACCEPT_EXTENSIONS) {
      expect(engineAccepts(bare, `doc${extension}`)).toBe(true);
    }
    expect(engineAccepts(bare, "doc.docx")).toBe(false);
  });
});

describe("allAcceptExtensions", () => {
  it("unions every engine's formats in list order without duplicates", () => {
    expect(allAcceptExtensions(engines)).toEqual([
      ".tex",
      ".md",
      ".markdown",
      ".ptx",
      ".zip",
      ".tar.gz",
      ".docx",
      ".epub",
      ".html",
    ]);
  });
});

describe("alternateEngine", () => {
  it("finds the later engine that duplicates coverage", () => {
    expect(alternateEngine(engines)?.id).toBe("pandoc");
  });

  it("finds nothing when engines do not overlap", () => {
    const disjoint = [
      builtin,
      { id: "pandoc", label: "Pandoc", acceptExtensions: [".docx", ".epub"] },
    ];
    expect(alternateEngine(disjoint)).toBeUndefined();
  });

  it("finds nothing for a lone engine", () => {
    expect(alternateEngine([builtin])).toBeUndefined();
  });
});

describe("routeEngine", () => {
  it("sends a format only one engine reads to that engine, unasked", () => {
    expect(routeEngine(engines, "thesis.docx")?.id).toBe("pandoc");
    expect(routeEngine(engines, "book.zip")?.id).toBe("builtin");
  });

  it("gives a shared format to the first engine that reads it", () => {
    expect(routeEngine(engines, "paper.tex")?.id).toBe("builtin");
    expect(routeEngine(engines, "notes.md")?.id).toBe("builtin");
  });

  it("returns undefined when nothing reads the file", () => {
    expect(routeEngine(engines, "photo.png")).toBeUndefined();
  });
});

describe("alternateFor", () => {
  it("offers the second converter for a format both read", () => {
    expect(alternateFor(engines, "paper.tex")?.id).toBe("pandoc");
    expect(alternateFor(engines, "notes.markdown")?.id).toBe("pandoc");
  });

  it("offers nothing for a format only one converter reads", () => {
    expect(alternateFor(engines, "thesis.docx")).toBeUndefined();
    expect(alternateFor(engines, "book.zip")).toBeUndefined();
    expect(alternateFor(engines, "main.ptx")).toBeUndefined();
  });

  it("offers nothing for a file nothing reads", () => {
    expect(alternateFor(engines, "photo.png")).toBeUndefined();
  });

  it("offers nothing when there is only one converter", () => {
    expect(alternateFor([builtin], "paper.tex")).toBeUndefined();
  });
});

describe("unsupportedFileMessage", () => {
  it("names every supported type when a file is rejected", () => {
    const message = unsupportedFileMessage("photo.png", engines);
    expect(message).toContain("photo.png");
    expect(message).toContain(".docx");
    expect(message).toContain(".tar.gz");
  });
});
