/**
 * The hierarchy of heading-producible PreTeXt divisions, ordered from
 * outermost to innermost. `book`/`article` are document roots and are never
 * chosen via heading depth, so they're intentionally excluded here.
 */

export type DivisionType =
  | 'part'
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'subsubsection'
  | 'paragraphs';

export const DIVISION_HIERARCHY: readonly DivisionType[] = [
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraphs',
];

export function isDivisionType(value: string): value is DivisionType {
  return (DIVISION_HIERARCHY as readonly string[]).includes(value);
}

/**
 * Resolve the division type at `depth` (1-based) relative to `topLevel`.
 * `depth` 1 means `topLevel` itself; deeper depths move down the hierarchy,
 * clamping at `paragraphs` (the innermost division) once exhausted.
 */
export function divisionTypeAtRelativeDepth(
  topLevel: DivisionType,
  depth: number,
): DivisionType {
  const startIndex = DIVISION_HIERARCHY.indexOf(topLevel);
  const index = startIndex + (depth - 1);
  return DIVISION_HIERARCHY[Math.min(index, DIVISION_HIERARCHY.length - 1)];
}
