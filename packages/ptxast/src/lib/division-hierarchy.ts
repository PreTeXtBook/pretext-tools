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
  | 'conclusion'
  | 'slide';

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
  'slide',
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

/**
 * PreTeXt document roots that can wrap an entire document. Unlike the
 * heading-producible divisions above, these are never chosen via heading
 * depth: they wrap the whole document, and a depth-1 heading (`#`) becomes
 * their outermost *child* division (see `rootChildDivision`).
 */
export type RootDivisionType = 'article' | 'book' | 'slideshow';

export const ROOT_DIVISION_TYPES: readonly RootDivisionType[] = [
  'article',
  'book',
  'slideshow',
];

export function isRootDivisionType(value: string): value is RootDivisionType {
  return (ROOT_DIVISION_TYPES as readonly string[]).includes(value);
}

/**
 * The division a depth-1 heading (`#`) maps to inside a given document root:
 * `book` numbers chapters, `article` numbers sections, and `slideshow`
 * contains sections that can contain slides. Deeper headings nest down from there via
 * `divisionTypeAtRelativeDepth` (chapters nest sections, sections nest
 * subsections, and slides — like other non-hierarchy divisions — clamp to
 * `paragraphs`).
 */
export function rootChildDivision(
  root: RootDivisionType,
): TopLevelDivisionType {
  return divisionTypeAtRootDepth(root, 1);
}

/**
 * A slideshow has its own division hierarchy: depth-1 headings become
 * `section`s, depth-2 headings become the `slide`s inside them, and anything
 * deeper collapses to `paragraphs`. (It intentionally does not reuse the
 * `section` → `subsection` chain of `DIVISION_HIERARCHY`.)
 */
const SLIDESHOW_HIERARCHY: readonly (DivisionType | ExtraDivisionType)[] = [
  'section',
  'slide',
  'paragraphs',
];

/**
 * Resolve the division type at heading `depth` (1-based) inside a given
 * document root. `book` starts at `chapter`, `article` at `section` (both
 * then following `DIVISION_HIERARCHY`), and `slideshow` follows its own
 * `section` → `slide` → `paragraphs` chain.
 */
export function divisionTypeAtRootDepth(
  root: RootDivisionType,
  depth: number,
): DivisionType | ExtraDivisionType {
  if (root === 'slideshow') {
    const index = Math.max(0, depth - 1);
    return SLIDESHOW_HIERARCHY[
      Math.min(index, SLIDESHOW_HIERARCHY.length - 1)
    ];
  }
  const child = root === 'book' ? 'chapter' : 'section';
  return divisionTypeAtRelativeDepth(child, depth);
}
