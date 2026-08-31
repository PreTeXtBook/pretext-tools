// The internal `<plus:TYPE ref="…"/>` division placeholder (SPEC §4.1), and
// the two operations every serializer needs on it: reading a division's
// children, and resolving them to hrefs.

/** Matches the canonical internal division placeholder (self-closing form). */
const DIVISION_PLACEHOLDER_RE =
  /<plus:([a-zA-Z][a-zA-Z-]*)\s+ref="([^"]+)"\s*\/>/g;

/** The refs of a division's direct children, in document order. */
export function divisionChildRefs(content: string): string[] {
  const refs: string[] = [];
  DIVISION_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIVISION_PLACEHOLDER_RE.exec(content)) !== null) {
    refs.push(m[2]);
  }
  return refs;
}

/** Rewrite each placeholder to the `<xi:include>` of the file it landed in. */
export function replacePlaceholders(
  content: string,
  hrefByRef: Map<string, string>,
): string {
  return content.replace(
    DIVISION_PLACEHOLDER_RE,
    (whole, _tag, ref: string) => {
      const href = hrefByRef.get(ref);
      return href ? `<xi:include href="${href}"/>` : whole;
    },
  );
}
