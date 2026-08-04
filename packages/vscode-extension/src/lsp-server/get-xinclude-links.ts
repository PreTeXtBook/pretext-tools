import { DocumentLink } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Matches the start tag of an `xi:include` (under any namespace prefix) that
 * carries an `href`, capturing the quote style and the raw attribute value.
 */
const XINCLUDE_HREF_RE =
  /<[A-Za-z_][\w.-]*:include\b[^>]*?\bhref\s*=\s*("|')(.*?)\1/g;

/** Regions whose contents are not markup and must not yield links. */
const IGNORED_REGION_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Resolve the XML entities an attribute value may contain. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|\w+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x")
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Blank out comments and CDATA, replacing them with spaces so that every
 * offset in the result still lines up with the original text.
 */
function maskIgnoredRegions(text: string): string {
  return text.replace(IGNORED_REGION_RE, (region) =>
    region.replace(/[^\n]/g, " "),
  );
}

/**
 * Return a clickable link for every `xi:include` in the document, pointing at
 * the included file. Hrefs are resolved relative to the containing document,
 * as XInclude requires.
 *
 * This scans text rather than walking the parsed tree on purpose: a document
 * with a single unclosed tag anywhere has no AST, and losing every include
 * link while the author is mid-edit is worse than the small risk of matching
 * something a strict parser would have read differently.
 */
export function getXincludeLinks(document: TextDocument): DocumentLink[] {
  const text = maskIgnoredRegions(document.getText());
  const links: DocumentLink[] = [];

  XINCLUDE_HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XINCLUDE_HREF_RE.exec(text)) !== null) {
    const rawHref = match[2];
    if (!rawHref.trim()) {
      continue;
    }
    // The value sits just inside the closing quote that ends the match.
    const valueStart = match.index + match[0].length - rawHref.length - 1;

    let target: string;
    try {
      target = "" + new URL(decodeEntities(rawHref), document.uri);
    } catch {
      continue;
    }

    links.push({
      range: {
        start: document.positionAt(valueStart),
        end: document.positionAt(valueStart + rawHref.length),
      },
      target,
      tooltip: `Open ${decodeEntities(rawHref)}`,
    });
  }

  return links;
}
