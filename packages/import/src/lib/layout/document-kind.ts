import { findAnyElement } from './xml-scan';

export type DocumentKind = 'article' | 'book';

export function detectDocumentKind(pretextSource: string): DocumentKind {
  if (findAnyElement(pretextSource, 'book')) {
    return 'book';
  }
  if (findAnyElement(pretextSource, 'article')) {
    return 'article';
  }
  if (findAnyElement(pretextSource, 'chapter')) {
    return 'book';
  }
  return 'article';
}
