import { describe, expect, it } from "vitest";
import { buildNativeDivisionPool } from "./native-pool";
import { serializeProjectToPlusPayload } from "./serialize-plus";

const LATEX_BOOK = String.raw`\documentclass{book}
\newcommand{\R}{\mathbb R}
\begin{document}
\chapter{Introduction}\label{intro}
Welcome to the book.
\chapter{Methods}
\section{Setup}
Install things.
\section{Analysis}
Crunch numbers.
\end{document}`;

describe("buildNativeDivisionPool (latex)", () => {
  it("splits chapters into native divisions with \\plus placeholders", () => {
    const { project } = buildNativeDivisionPool(LATEX_BOOK, "latex", {
      documentKind: "book",
      title: "My Book",
      docinfo:
        "<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>",
    });

    expect(project.documentKind).toBe("book");

    const root = project.divisions.find((d) => d.isRoot);
    expect(root?.sourceFormat).toBe("latex");
    expect(root?.type).toBe("book");
    // The root opens with its own header macro, then the child placeholders.
    expect(root?.content).toContain("\\book{My Book}\\label{document}");
    expect(root?.content).toContain("\\plus{chapter}{intro}");
    expect(root?.content).toContain("\\plus{chapter}{methods}");
    // The document body is hoisted out of the root; only placeholders remain.
    expect(root?.content).not.toContain("Welcome to the book.");
    // Preamble is dropped from division content (it lives in project docinfo).
    expect(root?.content).not.toContain("\\documentclass");

    const intro = project.divisions.find((d) => d.xmlId === "intro");
    expect(intro?.type).toBe("chapter");
    expect(intro?.sourceFormat).toBe("latex");
    expect(intro?.title).toBe("Introduction");
    expect(intro?.content).toContain("\\chapter{Introduction}\\label{intro}");
    expect(intro?.content).toContain("Welcome to the book.");

    // A chapter with no \label gets a ref slugged from its title.
    const methods = project.divisions.find((d) => d.title === "Methods");
    expect(methods?.xmlId).toBe("methods");
    // Sections stay inline when section-splitting is off.
    expect(methods?.content).toContain("\\section{Setup}");
    expect(methods?.content).not.toContain("\\plus{section}");
  });

  it("splits sections when requested, with chapter-scoped fallback refs", () => {
    const { project } = buildNativeDivisionPool(LATEX_BOOK, "latex", {
      documentKind: "book",
      splitSections: true,
    });

    const methods = project.divisions.find((d) => d.title === "Methods");
    expect(methods?.content).toContain("\\plus{section}{setup}");
    expect(methods?.content).toContain("\\plus{section}{analysis}");
    expect(methods?.content).not.toContain("Install things.");

    const setup = project.divisions.find((d) => d.xmlId === "setup");
    expect(setup?.type).toBe("section");
    expect(setup?.sourceFormat).toBe("latex");
    expect(setup?.content).toContain("\\section{Setup}\\label{setup}");
    expect(setup?.content).toContain("Install things.");
  });

  it("keeps a chapterless article as a single native root division", () => {
    const article = String.raw`\documentclass{article}
\begin{document}
\section{Only}
Body text.
\end{document}`;
    const { project } = buildNativeDivisionPool(article, "latex", {
      title: "Note",
    });

    expect(project.documentKind).toBe("article");
    expect(project.divisions).toHaveLength(1);
    expect(project.divisions[0].isRoot).toBe(true);
    expect(project.divisions[0].sourceFormat).toBe("latex");
    expect(project.divisions[0].content).toContain(
      "\\article{Note}\\label{document}",
    );
    expect(project.divisions[0].content).toContain("\\section{Only}");
    expect(project.divisions[0].content).toContain("Body text.");
  });
});

const MARKDOWN_BOOK = `# Introduction

Welcome to the book.

# Methods

## Setup

Install things.

## Analysis

Crunch numbers.
`;

describe("buildNativeDivisionPool (markdown)", () => {
  it("splits headings into native divisions with :: placeholders", () => {
    const { project } = buildNativeDivisionPool(MARKDOWN_BOOK, "markdown", {
      documentKind: "book",
      title: "My Book",
    });

    const root = project.divisions.find((d) => d.isRoot);
    expect(root?.sourceFormat).toBe("markdown");
    expect(root?.content).toContain("division: book");
    expect(root?.content).toContain("id: document");
    expect(root?.content).toContain("title: My Book");
    expect(root?.content).toContain('::chapter{ref="introduction"}');
    expect(root?.content).toContain('::chapter{ref="methods"}');
    expect(root?.content).not.toContain("Welcome to the book.");

    const intro = project.divisions.find((d) => d.xmlId === "introduction");
    expect(intro?.type).toBe("chapter");
    expect(intro?.sourceFormat).toBe("markdown");
    expect(intro?.content).toContain("division: chapter");
    expect(intro?.content).toContain("id: introduction");
    expect(intro?.content).toContain("title: Introduction");
    expect(intro?.content).toContain("# Introduction");
    expect(intro?.content).toContain("Welcome to the book.");
  });

  it("splits sections and demotes their heading to a top-level #", () => {
    const { project } = buildNativeDivisionPool(MARKDOWN_BOOK, "markdown", {
      documentKind: "book",
      splitSections: true,
    });

    const methods = project.divisions.find((d) => d.xmlId === "methods");
    expect(methods?.content).toContain('::section{ref="setup"}');
    expect(methods?.content).not.toContain("Install things.");

    const setup = project.divisions.find((d) => d.xmlId === "setup");
    expect(setup?.type).toBe("section");
    expect(setup?.sourceFormat).toBe("markdown");
    // Originally "## Setup"; a division always leads with a single "#".
    expect(setup?.content).toContain("# Setup");
    expect(setup?.content).not.toContain("## Setup");
    expect(setup?.content).toContain("Install things.");
  });

  it("does not treat a heading inside a fenced code block as a division", () => {
    const source = "# Real\n\n```\n# not a heading\n```\n\nText.\n";
    const { project } = buildNativeDivisionPool(source, "markdown", {
      documentKind: "book",
    });

    const chapters = project.divisions.filter((d) => d.type === "chapter");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].xmlId).toBe("real");
    expect(chapters[0].content).toContain("# not a heading");
  });
});

describe("serializeProjectToPlusPayload (native pools)", () => {
  it("emits latex divisions with source_format latex", () => {
    const { project } = buildNativeDivisionPool(LATEX_BOOK, "latex", {
      documentKind: "book",
      title: "My Book",
    });
    const payload = serializeProjectToPlusPayload(project);

    expect(payload.document_type).toBe("book");
    expect(
      payload.divisions_attributes.every((d) => d.source_format === "latex"),
    ).toBe(true);
    const root = payload.divisions_attributes.find((d) => d.is_root);
    expect(root?.source).toContain("\\plus{chapter}{intro}");
    expect(payload.divisions_attributes.filter((d) => d.is_root)).toHaveLength(
      1,
    );
  });

  it("emits markdown divisions with source_format markdown", () => {
    const { project } = buildNativeDivisionPool(MARKDOWN_BOOK, "markdown", {
      documentKind: "book",
    });
    const payload = serializeProjectToPlusPayload(project);

    expect(
      payload.divisions_attributes.every((d) => d.source_format === "markdown"),
    ).toBe(true);
    const root = payload.divisions_attributes.find((d) => d.is_root);
    expect(root?.source).toContain('::chapter{ref="introduction"}');
  });
});
