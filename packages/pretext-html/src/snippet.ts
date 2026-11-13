/**
 * Rendering a snippet of PreTeXt — a paragraph and a theorem, say — to just
 * its HTML, without the page around it: no masthead, table of contents,
 * navigation footer or `<head>`.
 *
 * The PreTeXt stylesheets only ever build whole documents, so the snippet is
 * wrapped in one (an untitled `<article>`, whose `xml:id` is the snippet's
 * id prefix), rendered as any document is, and its content cut back out of
 * the page. An untitled article emits no heading, so what comes back is the
 * snippet's own markup and nothing else.
 *
 * The HTML is a fragment for an embedder to place in a page of its own, which
 * is then responsible for what the full page would have loaded: PreTeXt's
 * CSS (whose rules are scoped under `.ptx-content`, so put the fragment
 * inside such an element) and MathJax (math arrives as `\(…\)` inside
 * `.process-math` spans).
 */

import * as path from "node:path";
import type { IframePages } from "./iframe-pages.js";
import {
  docinfoFromSource,
  renderHtml,
  resolveOptionsFor,
  type RenderOptions,
  type RenderResult,
} from "./renderer.js";

export interface SnippetOptions extends Pick<
  RenderOptions,
  | "projectDir"
  | "mainSourcePath"
  | "publicationPath"
  | "cssTheme"
  | "stringParams"
  | "xslDir"
  | "openKnowls"
  | "offPageMessage"
  | "files"
  | "readSource"
  | "cache"
  | "docinfo"
  | "docinfoSourcePath"
> {
  /**
   * The PreTeXt to render: block-level content as it would appear inside a
   * division — any number of top-level elements (`<p>`, `<theorem>`,
   * `<figure>`, …), even a subsection or two. Need not be a single element,
   * and is not a whole document.
   */
  content: string;
  /**
   * The `xml:id` of the wrapper the snippet is rendered inside. Every HTML id
   * PreTeXt generates for the snippet's elements starts with it, so give each
   * snippet sharing a page its own prefix to keep their ids apart. Must be a
   * valid XML name without a colon. Defaults to `"snippet"`.
   */
  idPrefix?: string;
  /**
   * Where the snippet notionally lives: the base its relative `xi:include`s
   * and asset paths resolve against. Defaults to a file in the working
   * directory (the root, in the browser build). Never read.
   */
  sourcePath?: string;
}

export interface SnippetResult {
  /** The snippet's rendered HTML, and nothing around it. */
  html: string;
  /**
   * PreTeXt's hidden `<div id="latex-macros">`, which holds the docinfo's
   * LaTeX macros for MathJax to read. Returned apart from {@link html} so a
   * page of several snippets includes it once; empty if the page had none.
   */
  latexMacros: string;
  /** As {@link RenderResult.iframePages}. */
  iframePages: IframePages;
  /** As {@link RenderResult.assetDirs}. */
  assetDirs: RenderResult["assetDirs"];
}

/** An XML NCName, close enough: what an `xml:id` (and an HTML id) can be. */
const NCNAME = /^[A-Za-z_][\w.-]*$/;

/**
 * Render a snippet of PreTeXt to an HTML fragment (see the module comment).
 * Concurrent calls queue behind one another, as {@link renderHtml}'s do.
 */
export async function renderSnippet(
  options: SnippetOptions,
): Promise<SnippetResult> {
  const idPrefix = options.idPrefix ?? "snippet";
  if (!NCNAME.test(idPrefix)) {
    throw new Error(
      `Invalid snippet idPrefix "${idPrefix}": it must start with a letter ` +
        `or underscore and contain only letters, digits, "_", "-" and ".".`,
    );
  }
  const sourcePath = path.resolve(
    options.sourcePath ?? "__pretext-snippet.ptx",
  );
  const projectDir = path.resolve(
    options.projectDir ?? path.dirname(sourcePath),
  );
  const docinfo =
    options.docinfo ??
    (options.docinfoSourcePath
      ? await docinfoFromSource(
          options.docinfoSourcePath,
          projectDir,
          resolveOptionsFor({ ...options, sourcePath }),
        )
      : undefined);

  const body = options.content
    .replace(/^﻿/, "")
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!DOCTYPE[^>]*>/i, "");
  const docinfoBlock = docinfo?.trim() ? `${docinfo.trim()}\n` : "";
  const wrapped =
    `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">\n${docinfoBlock}` +
    `<article xml:id="${idPrefix}">\n<title/>\n${body}\n</article>\n</pretext>\n`;

  const result = await renderHtml({
    sourcePath,
    sourceContent: wrapped,
    projectDir,
    mainSourcePath: options.mainSourcePath,
    publicationPath: options.publicationPath,
    cssTheme: options.cssTheme,
    stringParams: options.stringParams,
    xslDir: options.xslDir,
    openKnowls: options.openKnowls,
    offPageMessage: options.offPageMessage,
    files: options.files,
    readSource: options.readSource,
    cache: options.cache,
    target: "html",
  });
  return {
    ...extractSnippet(result.html, idPrefix),
    iframePages: result.iframePages,
    assetDirs: result.assetDirs,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cut a snippet back out of the page {@link renderSnippet} rendered it in:
 * the content of the `<section id="{id}">` its wrapper became, and the
 * page's LaTeX macros. Exported for embedders that render the wrapper
 * themselves. Throws when the page has no such section.
 */
export function extractSnippet(
  html: string,
  id: string,
): { html: string; latexMacros: string } {
  const open = new RegExp(
    `<section\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`,
    "i",
  ).exec(html);
  if (!open) {
    throw new Error(
      `Could not find the snippet (<section id="${id}">) in the rendered page.`,
    );
  }
  const start = open.index + open[0].length;
  // Match the section's own close, past any sections nested inside it.
  const tags = /<(\/?)section\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1;
  let end = -1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) {
      end = tag.index;
      break;
    }
  }
  if (end === -1) {
    throw new Error(`The snippet's <section id="${id}"> is never closed.`);
  }
  // Its content is plain text (macro definitions), so the first close is its.
  const macros =
    /<div\b[^>]*\bid=["']latex-macros["'][^>]*>[\s\S]*?<\/div>/i.exec(html);
  // The wrapper's own permalink closes the section; it links to an element
  // the fragment does not contain.
  const ownPermalink = new RegExp(
    `<div\\b[^>]*\\bclass=["']autopermalink["'][^>]*>\\s*<a\\b[^>]*\\bhref=["']#${escapeRegExp(id)}["'][^>]*>[\\s\\S]*?</a>\\s*</div>\\s*$`,
    "i",
  );
  return {
    html: html.slice(start, end).trim().replace(ownPermalink, "").trim(),
    latexMacros: macros?.[0] ?? "",
  };
}
