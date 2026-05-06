/**
 * Directive Normalizer
 *
 * Transforms user-friendly flexible colon syntax into standard remark-directive format.
 *
 * INPUT (flexible):
 *   :::exercise
 *   Intro
 *   :::task
 *   Content
 *   :::
 *   :::
 *
 * OUTPUT (normalized for remark-directive):
 *   ::::exercise
 *   Intro
 *   :::task
 *   Content
 *   :::
 *   ::::
 *
 * Rules:
 * 1. Track nesting depth per colon count
 * 2. When closing marker seen (colons + newline/EOF), match to innermost open at that depth
 * 3. Emit additional colons to outer directives so remark-directive sees proper nesting
 * 4. If closing marker has no matching open, leave unchanged (let remark-directive handle error)
 */

interface DirectiveMarker {
  colons: number;
  label: string | null;
  lineIndex: number;
  isOpen: boolean; // true if has label, false if just colons
}

/**
 * Parse a line to check if it's a directive marker (colons + optional label + optional braces)
 * Returns: { colons, label } or null if not a directive
 *
 * Valid markers:
 *   :::
 *   :::exercise
 *   :::exercise[Title]
 *   :::exercise{#id}
 */
function parseDirectiveMarker(line: string): DirectiveMarker | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(':')) return null;

  // Count leading colons
  let colonCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === ':') colonCount++;
    else break;
  }

  // Minimum 3 colons
  if (colonCount < 3) return null;

  // After colons, either nothing or a label (word characters, brackets, braces)
  const afterColons = trimmed.slice(colonCount).trim();
  const labelMatch = afterColons.match(/^([a-zA-Z0-9_-]+)(\[.*?\])?(\{.*?\})?$/);

  if (afterColons === '') {
    // Closing marker: just colons
    return { colons: colonCount, label: null, lineIndex: -1, isOpen: false };
  } else if (labelMatch) {
    // Opening marker: colons + label
    return { colons: colonCount, label: labelMatch[0], lineIndex: -1, isOpen: true };
  }

  // Invalid marker, ignore
  return null;
}

/**
 * Normalize markdown by adjusting colon counts for proper resting-directive nesting.
 *
 * Algorithm:
 * 1. Scan all lines for directive markers (open/close)
 * 2. Track a stack of open directives: { colons, lineIndex }
 * 3. When closing marker seen:
 *    - Find deepest open directive with same colon count
 *    - If not found, it's an error or unrelated marker (leave as-is)
 *    - If found, check if we need to emit extra colons (to satisfy outer nesting)
 * 4. Emit normalized markdown
 *
 * Key insight: remark-directive requires outer to have MORE colons than inner.
 * So if user writes both at :::, we increment outer to ::::
 */
export function normalizeDirectiveColons(markdown: string): string {
  const lines = markdown.split('\n');
  const markers: Array<DirectiveMarker & { lineIndex: number }> = [];

  // Step 1: Identify all directive markers
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseDirectiveMarker(lines[i]);
    if (parsed) {
      markers.push({ ...parsed, lineIndex: i });
    }
  }

  if (markers.length === 0) {
    // No directives, return unchanged
    return markdown;
  }

  // Step 2: Build a stack-based nesting structure
  // For each closing marker, find its matching opening marker and adjust outer colons
  const stack: Array<{ colons: number; lineIndex: number; label: string | null }> = [];
  const outputLines = lines.slice(); // Will be mutated

  for (const marker of markers) {
    if (marker.isOpen) {
      // Opening marker: push onto stack
      stack.push({ colons: marker.colons, lineIndex: marker.lineIndex, label: marker.label });
    } else {
      // Closing marker: find matching open directive
      // Strategy: search stack from top (most recent) downward for matching colon count
      const matchIndex = findMatchingOpen(stack, marker.colons);

      if (matchIndex !== -1) {
        const matched = stack[matchIndex];

        // Check if we need to adjust colons for remark-directive nesting
        // If there are any directives deeper than this one, we need outer to have more colons
        if (matchIndex < stack.length - 1) {
          // There are deeper directives. Increment outer to ensure remark-directive sees it as parent.
          const innerMaxColons = Math.max(...stack.slice(matchIndex + 1).map((d) => d.colons));
          if (matched.colons <= innerMaxColons) {
            const newColons = innerMaxColons + 1;
            const oldMarkerLine = outputLines[matched.lineIndex];
            const newMarkerLine = ':'.repeat(newColons) + oldMarkerLine.slice(matched.colons);
            outputLines[matched.lineIndex] = newMarkerLine;

            // Also emit closing with new colon count
            outputLines[marker.lineIndex] = ':'.repeat(newColons);
          } else {
            // Outer already has enough colons
            outputLines[marker.lineIndex] = ':'.repeat(matched.colons);
          }
        } else {
          // No deeper directives, emit closing with same colon count
          outputLines[marker.lineIndex] = ':'.repeat(matched.colons);
        }

        // Remove matched directive from stack
        // IMPORTANT: Use splice(matchIndex, 1) not pop() to handle out-of-order closing markers.
        // For valid markdown (LIFO closing order), matchIndex will be stack.length - 1.
        // For malformed markdown with out-of-order markers, splice ensures we remove the correct one.
        stack.splice(matchIndex, 1);
      } else {
        // No matching open found. Leave the closing marker as-is.
        // remark-directive will handle the error or treat as literal text.
        outputLines[marker.lineIndex] = lines[marker.lineIndex];
      }
    }
  }

  return outputLines.join('\n');
}

/**
 * Find matching opening marker for a closing marker with given colon count.
 * Search from top of stack (most recent) downward.
 *
 * Returns index in stack, or -1 if not found.
 */
function findMatchingOpen(
  stack: Array<{ colons: number; lineIndex: number; label: string }>,
  colonCount: number
): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].colons === colonCount) {
      return i;
    }
  }
  return -1;
}
