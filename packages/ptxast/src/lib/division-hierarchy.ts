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
 * Section-like divisions that a heading can declare as its own type (via
 * `division:` frontmatter or an explicit option) but that don't extend the
 * part/chapter/.../paragraphs hierarchy the way `DivisionType` values do.
 * `appendix` is the exception: like `chapter`, it can contain nested
 * `section`/`subsection`/etc., so it reuses the `chapter` hierarchy slot for
 * deeper headings. The rest don't support nested sections in the PreTeXt
 * schema, so deeper headings inside them become `paragraphs` divisions.
 */
export type ExtraDivisionType =
  | 'worksheet'
  | 'exercises'
  | 'references'
  | 'appendix'
  | 'glossary'
  | 'handout'
  | 'solutions'
  | 'reading-questions'
  | 'introduction'
  | 'conclusion';

export const EXTRA_DIVISION_TYPES: readonly ExtraDivisionType[] = [
  'worksheet',
  'exercises',
  'references',
  'appendix',
  'glossary',
  'handout',
  'solutions',
  'reading-questions',
  'introduction',
  'conclusion',
];

export function isExtraDivisionType(value: string): value is ExtraDivisionType {
  return (EXTRA_DIVISION_TYPES as readonly string[]).includes(value);
}

/**
 * The subset of `ExtraDivisionType` that has no `<title>` in the PreTeXt
 * schema: an unlabeled block of content rather than a numbered/titled
 * division. Every heading depth inside one of these resolves to `paragraphs`
 * (there's no title slot for the division itself to consume).
 */
export type TitlelessDivisionType = 'introduction' | 'conclusion';

export const TITLELESS_DIVISION_TYPES: readonly TitlelessDivisionType[] = [
  'introduction',
  'conclusion',
];

export function isTitlelessDivisionType(
  value: string,
): value is TitlelessDivisionType {
  return (TITLELESS_DIVISION_TYPES as readonly string[]).includes(value);
}

/** Every division-like type a heading can be converted into via `division:`. */
export type TopLevelDivisionType = DivisionType | ExtraDivisionType;

export function isTopLevelDivisionType(
  value: string,
): value is TopLevelDivisionType {
  return isDivisionType(value) || isExtraDivisionType(value);
}

/**
 * Resolve the division type at `depth` (1-based) relative to `topLevel`.
 * `depth` 1 means `topLevel` itself; deeper depths move down the hierarchy,
 * clamping at `paragraphs` (the innermost division) once exhausted.
 *
 * `topLevel` may also be one of the `ExtraDivisionType` values: `appendix`
 * nests like `chapter`; `introduction`/`conclusion` have no title slot of
 * their own, so every depth (including 1) resolves to `paragraphs`; the rest
 * clamp straight to `paragraphs` for any heading deeper than the top level.
 */
export function divisionTypeAtRelativeDepth(
  topLevel: TopLevelDivisionType,
  depth: number,
): DivisionType | ExtraDivisionType {
  if (isTitlelessDivisionType(topLevel)) return 'paragraphs';
  if (depth <= 1) return topLevel;
  if (topLevel === 'appendix') return divisionTypeAtRelativeDepth('chapter', depth);
  if (isExtraDivisionType(topLevel)) return 'paragraphs';

  const startIndex = DIVISION_HIERARCHY.indexOf(topLevel);
  const index = startIndex + (depth - 1);
  return DIVISION_HIERARCHY[Math.min(index, DIVISION_HIERARCHY.length - 1)];
}
