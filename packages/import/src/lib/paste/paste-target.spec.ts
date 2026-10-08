import { describe, expect, it } from "vitest";
import { pasteTargetAt } from "./paste-target";

describe("pasteTargetAt: where converted markup does not belong", () => {
  it.each([
    ["<latex-image>", "<image>\n  <latex-image>\n    "],
    ["<latex-image> after other TikZ", "<latex-image>\\begin{tikzpicture}\n"],
    ["inline math", "<p>Let <m>"],
    ["an <mrow>", "<md>\n  <mrow>x &amp;= "],
    ["an <xref> inside display math", '<md><mrow>x <xref ref="a">'],
    ["deprecated <me>", "<p><me>"],
    ["<code> in a <program>", '<program language="python">\n  <code>\n'],
    ["a <program> itself", '<program language="python">\n'],
    ["a Sage cell", "<sage>\n  <input>\n"],
    ["a console", "<console><input>"],
    ["<pre>", "<pre>\n"],
    ["inline code", "<p>Run <c>"],
    ["<macros>", "<docinfo><macros>\n"],
    ["a Prefigure diagram", "<image><prefigure><diagram>\n"],
    ["<cd>", "<cd>\n  <cline>"],
  ])("inside %s", (_label, prefix) => {
    expect(pasteTargetAt(prefix).literal).toMatch(/verbatim|LaTeX already/);
  });

  it.each([
    ["a comment", "<p>Text <!-- a note about "],
    ["an attribute value", '<section xml:id="sec-'],
    ["a start tag", "<section "],
    ["a CDATA section", "<pre><![CDATA[ "],
    ["a processing instruction", "<?xml version="],
  ])("inside %s", (_label, prefix) => {
    expect(pasteTargetAt(prefix).literal).toMatch(/inside a tag/);
  });

  it.each([
    ["a made-up element", "<section><frobnicate>", "frobnicate"],
    [
      "a namespaced Prefigure diagram",
      '<image><pf:prefigure xmlns:pf="x"><diagram>',
      "diagram",
    ],
  ])("inside %s", (_label, prefix, name) => {
    expect(pasteTargetAt(prefix).literal).toMatch(
      new RegExp(`<${name}>, which is not a PreTeXt element`),
    );
  });

  it("inside an element that holds only plain text", () => {
    expect(pasteTargetAt("<p>Press <kbd>").literal).toMatch(
      /<kbd>, which cannot hold markup/,
    );
  });
});

describe("pasteTargetAt: where converted markup belongs", () => {
  it.each([
    ["an empty document", ""],
    ["between blocks in a section", "<section>\n  <title>One</title>\n  "],
    ["a <p>", "<section><p>Some text "],
    ["after closed math in a <p>", "<p>Let <m>x</m> and "],
    ["after a closed <latex-image>", "<image><latex-image>x</latex-image>"],
    ["a <title>", "<section><title>"],
    ["between chapters of a <book>", "<book>\n  <chapter></chapter>\n  "],
    ["a <definition> before its statement", "<definition>\n  "],
    ["an <exercises> division", "<exercises>\n  "],
    ["after a comment", "<section><!-- a $x$ note -->\n  "],
    ["an attribute value with > in it", '<section label="a > b">\n  '],
  ])("in %s", (_label, prefix) => {
    expect(pasteTargetAt(prefix).literal).toBeUndefined();
  });
});

describe("pasteTargetAt: inline or block", () => {
  it.each([
    ["a <p>", "<section><p>Some text "],
    ["emphasis in a <p>", "<p>A <em>"],
    // Not a paragraph, but it takes inline markup only: a pasted `$x$` must
    // become `<m>x</m>`, not `<p><m>x</m></p>`.
    ["a <title>", "<section><title>"],
    ["a <caption>", "<figure><caption>"],
    ["a list item inside a paragraph", "<p><ol><li>"],
  ])("is inline in %s", (_label, prefix) => {
    expect(pasteTargetAt(prefix).inline).toBe(true);
  });

  it.each([
    ["an empty document", ""],
    ["a <section>", "<section>\n  "],
    ["a <section> after a closed paragraph", "<section><p>Done.</p>\n  "],
    ["a <statement>", "<theorem><statement>"],
    // An <aside> takes paragraphs, even in a list item inside a paragraph.
    ["an <aside> in a list item", "<p><ol><li><aside>"],
    ["a table cell", "<tabular><row><cell>"],
  ])("is block in %s", (_label, prefix) => {
    expect(pasteTargetAt(prefix).inline).toBe(false);
  });
});
