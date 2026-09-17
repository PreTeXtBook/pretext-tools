import { findAnyElement } from "./xml-scan";

export type DocumentKind = "article" | "book" | "slideshow";

export function detectDocumentKind(pretextSource: string): DocumentKind {
  if (findAnyElement(pretextSource, "slideshow")) {
    return "slideshow";
  }
  if (findAnyElement(pretextSource, "book")) {
    return "book";
  }
  if (findAnyElement(pretextSource, "article")) {
    return "article";
  }
  if (findAnyElement(pretextSource, "chapter")) {
    return "book";
  }
  // A bare `<slide>` can only have come from a slideshow — no other PreTeXt
  // root admits one — so it settles the kind the way `<chapter>` settles book.
  if (findAnyElement(pretextSource, "slide")) {
    return "slideshow";
  }
  return "article";
}
