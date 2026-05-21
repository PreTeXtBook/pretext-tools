import type { CleaningWarning } from "../clean/warnings";
import {
  detectDocumentKind,
  type DocumentKind,
} from "./document-kind";
import {
  renderProjectPtx,
  renderPublicationPtx,
  renderXmlProlog,
} from "./templates";
import {
  findAnyElement,
  findFirstElement,
  findTopLevelElements,
  type XmlElementSpan,
} from "./xml-scan";

const XI_NAMESPACE = "http://www.w3.org/2001/XInclude";

export interface BuildProjectFilesOptions {
  documentKind?: DocumentKind;
  splitChapters?: boolean;
  splitSections?: boolean;
  mainSourcePath?: string;
  publicationPath?: string;
  projectFilePath?: string;
  docinfoPath?: string;
}

export interface BuildProjectFilesResult {
  files: Record<string, string>;
  documentKind: DocumentKind;
  warnings: CleaningWarning[];
}

const DEFAULTS = {
  mainSourcePath: "source/main.ptx",
  publicationPath: "publication/publication.ptx",
  projectFilePath: "project.ptx",
  docinfoPath: "source/docinfo.ptx",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function padIndex(index: number, total: number): string {
  const width = String(total).length;
  return String(index).padStart(Math.max(width, 2), "0");
}

function ensureXIncludeNamespace(content: string): string {
  // Look for the outermost root element to attach the namespace to.
  return content.replace(
    /<(pretext|book|article)\b([^>]*)>/,
    (whole, tag: string, attrs: string) => {
      if (/\bxmlns:xi\s*=/.test(attrs)) {
        return whole;
      }
      return `<${tag}${attrs} xmlns:xi="${XI_NAMESPACE}">`;
    },
  );
}

function wrapInPretextRoot(content: string): string {
  if (findAnyElement(content, "pretext")) {
    return content;
  }
  return `<pretext>\n${content}\n</pretext>`;
}

function withProlog(content: string): string {
  if (content.startsWith("<?xml")) return content;
  return renderXmlProlog() + content;
}

interface ExtractedElement {
  span: XmlElementSpan;
  slug: string;
  filename: string;
}

function nameElements(
  spans: XmlElementSpan[],
  prefix: string,
  warnings: CleaningWarning[],
): ExtractedElement[] {
  const slugCounts = new Map<string, number>();
  const out: ExtractedElement[] = [];
  const prefixWithDash = `${prefix}-`;
  spans.forEach((span, index) => {
    const rawId = span.attributes["xml:id"];
    let slug: string;
    if (rawId) {
      const cleaned = slugify(rawId);
      slug = cleaned.startsWith(prefixWithDash)
        ? cleaned
        : `${prefixWithDash}${cleaned}`;
    } else {
      slug = `${prefixWithDash}${padIndex(index + 1, spans.length)}`;
      warnings.push({
        action: "anomaly",
        severity: "info",
        kind: "structure",
        category: "missing_xml_id",
        macro: span.name,
        occurrences: 1,
        message: `<${span.name}> at position ${index + 1} has no xml:id; using \`${slug}\` as filename.`,
      });
    }
    const count = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, count + 1);
    const finalSlug = count === 0 ? slug : `${slug}-${count + 1}`;
    out.push({
      span,
      slug: finalSlug,
      filename: `${finalSlug}.ptx`,
    });
  });
  return out;
}

// Replace each span's outer with a placeholder string, splicing back into source.
function spliceReplacements(
  source: string,
  replacements: Array<{ start: number; end: number; replacement: string }>,
): string {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const r of sorted) {
    result += source.slice(cursor, r.start);
    result += r.replacement;
    cursor = r.end;
  }
  result += source.slice(cursor);
  return result;
}

// Extract direct-child <section> elements within a chapter and split them out.
function splitSectionsForChapter(
  chapterInner: string,
  chapterSlug: string,
  files: Record<string, string>,
  warnings: CleaningWarning[],
): string {
  const sectionSpans = findTopLevelElements(chapterInner, "section");
  if (sectionSpans.length === 0) {
    return chapterInner;
  }
  const sections = nameElements(sectionSpans, "sec", warnings);
  const replacements = sections.map((sec) => {
    const sectionFile = `source/${chapterSlug}/${sec.filename}`;
    files[sectionFile] = withProlog(sec.span.outer);
    return {
      start: sec.span.start,
      end: sec.span.end,
      replacement: `<xi:include href="${chapterSlug}/${sec.filename}"/>`,
    };
  });
  return spliceReplacements(chapterInner, replacements);
}

function buildBookProject(
  pretextSource: string,
  options: Required<BuildProjectFilesOptions>,
  warnings: CleaningWarning[],
): Record<string, string> {
  const bookSpan = findAnyElement(pretextSource, "book");
  if (!bookSpan) {
    // Caller said this was a book but we can't find <book>. Fall back to wrap.
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "missing_root",
      macro: "book",
      occurrences: 1,
      message: "Document was treated as a book but no <book> element found; emitting as a single file.",
    });
    return buildArticleProject(pretextSource, options, warnings);
  }

  const files: Record<string, string> = {};
  const chapterSpans = findTopLevelElements(bookSpan.inner, "chapter");
  let bookInner = bookSpan.inner;

  if (options.splitChapters && chapterSpans.length > 0) {
    const chapters = nameElements(chapterSpans, "ch", warnings);
    const replacements = chapters.map((ch) => {
      let chapterContent = ch.span.outer;
      if (options.splitSections) {
        const inner = ch.span.inner;
        const newInner = splitSectionsForChapter(inner, ch.slug, files, warnings);
        chapterContent =
          ch.span.outer.slice(0, ch.span.startTagEnd - ch.span.start) +
          newInner +
          ch.span.outer.slice(ch.span.contentEnd - ch.span.start);
      }
      const chapterFile = `source/${ch.filename}`;
      files[chapterFile] = withProlog(chapterContent);
      return {
        start: ch.span.start,
        end: ch.span.end,
        replacement: `<xi:include href="${ch.filename}"/>`,
      };
    });
    bookInner = spliceReplacements(bookSpan.inner, replacements);
  }

  const newBookOuter =
    pretextSource.slice(bookSpan.start, bookSpan.startTagEnd) +
    bookInner +
    pretextSource.slice(bookSpan.contentEnd, bookSpan.end);

  const mainContent =
    pretextSource.slice(0, bookSpan.start) +
    newBookOuter +
    pretextSource.slice(bookSpan.end);

  files[options.mainSourcePath] = withProlog(
    ensureXIncludeNamespace(wrapInPretextRoot(mainContent.trim())),
  );
  return files;
}

function buildArticleProject(
  pretextSource: string,
  options: Required<BuildProjectFilesOptions>,
  _warnings: CleaningWarning[],
): Record<string, string> {
  const files: Record<string, string> = {};
  files[options.mainSourcePath] = withProlog(
    wrapInPretextRoot(pretextSource.trim()),
  );
  return files;
}

export function buildPretextProjectFiles(
  pretextSource: string,
  options: BuildProjectFilesOptions = {},
): BuildProjectFilesResult {
  const warnings: CleaningWarning[] = [];
  const documentKind: DocumentKind =
    options.documentKind ?? detectDocumentKind(pretextSource);

  const resolved: Required<BuildProjectFilesOptions> = {
    documentKind,
    splitChapters: options.splitChapters ?? documentKind === "book",
    splitSections: options.splitSections ?? false,
    mainSourcePath: options.mainSourcePath ?? DEFAULTS.mainSourcePath,
    publicationPath: options.publicationPath ?? DEFAULTS.publicationPath,
    projectFilePath: options.projectFilePath ?? DEFAULTS.projectFilePath,
    docinfoPath: options.docinfoPath ?? DEFAULTS.docinfoPath,
  };

  const files =
    documentKind === "book"
      ? buildBookProject(pretextSource, resolved, warnings)
      : buildArticleProject(pretextSource, resolved, warnings);

  files[resolved.projectFilePath] = renderProjectPtx({
    mainSource: resolved.mainSourcePath,
    publication: resolved.publicationPath,
  });
  files[resolved.publicationPath] = renderPublicationPtx();

  return { files, documentKind, warnings };
}
