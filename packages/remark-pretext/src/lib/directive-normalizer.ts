/**
 * Directive Normalizer (Two-Pass Algorithm)
 *
 * Transforms user-friendly flexible colon syntax into standard remark-directive format.
 *
 * INPUT (flexible):
 *   :::exercise
 *   Intro
 *   :::task
 *   Content
 *   :::
 *   :::task
 *   More
 *   :::
 *   :::
 *
 * OUTPUT (normalized for remark-directive):
 *   ::::exercise
 *   Intro
 *   :::task
 *   Content
 *   :::
 *   :::task
 *   More
 *   :::
 *   ::::
 *
 * Algorithm (Two-Pass):
 * - Pass 1: Parse markers, build nesting tree with parent references
 * - Pass 2: Traverse tree bottom-up, compute final colon counts
 *   (each parent = max(children) + 1, ensuring proper nesting)
 * - Pass 3: Re-emit with adjusted markers
 */

interface DirectiveMarker {
  colons: number;
  label: string | null;
  lineIndex: number;
  isOpen: boolean;
}

interface TreeNode {
  colons: number; // Original opening colon count
  finalColons: number; // Computed final colon count
  label: string | null;
  openLineIndex: number;
  closeLineIndex: number | null;
  children: TreeNode[];
  parent: TreeNode | null;
}

/**
 * Parse a line to check if it's a directive marker
 */
function parseDirectiveMarker(line: string): DirectiveMarker | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(':')) return null;

  let colonCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === ':') colonCount++;
    else break;
  }

  if (colonCount < 3) return null;

  const afterColons = trimmed.slice(colonCount).trim();
  const labelMatch = afterColons.match(/^([a-zA-Z0-9_-]+)(\[.*?\])?(\{.*?\})?$/);

  if (afterColons === '') {
    return { colons: colonCount, label: null, lineIndex: -1, isOpen: false };
  } else if (labelMatch) {
    return { colons: colonCount, label: labelMatch[0], lineIndex: -1, isOpen: true };
  }

  return null;
}

/**
 * Pass 1: Parse markers and build tree with proper parent-child relationships
 */
function buildTree(markers: Array<DirectiveMarker & { lineIndex: number }>): TreeNode[] {
  const stack: TreeNode[] = []; // Stack of currently-open directives
  const roots: TreeNode[] = [];

  for (const marker of markers) {
    if (marker.isOpen) {
      // Create new node
      const node: TreeNode = {
        colons: marker.colons,
        finalColons: marker.colons,
        label: marker.label,
        openLineIndex: marker.lineIndex,
        closeLineIndex: null,
        children: [],
        parent: null,
      };

      // Attach to parent if exists
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        node.parent = parent;
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      stack.push(node);
    } else {
      // Closing marker: find matching open
      const matchIndex = findMatchingOpenInStack(stack, marker.colons);
      if (matchIndex !== -1) {
        const node = stack[matchIndex];
        node.closeLineIndex = marker.lineIndex;
        // Remove from stack (pop everything after this node first)
        stack.splice(matchIndex, 1);
      }
      // If no match, it's an orphan closing marker—leave as literal
    }
  }

  return roots;
}

/**
 * Find matching open in stack (search from most recent downward)
 */
function findMatchingOpenInStack(stack: TreeNode[], colonCount: number): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].colons === colonCount) {
      return i;
    }
  }
  return -1;
}

/**
 * Pass 2: Traverse tree bottom-up, compute final colon counts
 * Each parent must have more colons than all its children
 */
function computeFinalColons(node: TreeNode): number {
  if (node.children.length === 0) {
    // Leaf: keep original colon count
    node.finalColons = node.colons;
  } else {
    // Interior: must be greater than all children
    const maxChildColons = Math.max(...node.children.map(computeFinalColons));
    node.finalColons = Math.max(node.colons, maxChildColons + 1);
  }
  return node.finalColons;
}

/**
 * Pass 3: Rebuild markdown with adjusted colon counts
 */
function rebuildMarkdown(
  lines: string[],
  roots: TreeNode[],
  _allMarkers: Array<DirectiveMarker & { lineIndex: number }>
): string[] {
  const output = lines.slice();

  // Collect all nodes (breadth-first traversal for easier processing)
  const allNodes: TreeNode[] = [];
  const queue: TreeNode[] = roots.slice();
  while (queue.length > 0) {
    const node = queue.shift()!;
    allNodes.push(node);
    queue.push(...node.children);
  }

  // Update opening and closing markers with final colon counts
  for (const node of allNodes) {
    if (node.openLineIndex >= 0) {
      const oldMarkerLine = output[node.openLineIndex];
      // Count leading colons to preserve the rest of the line
      const colonCount = oldMarkerLine.match(/^:+/)?.[0].length || 3;
      const rest = oldMarkerLine.slice(colonCount);
      output[node.openLineIndex] = ':'.repeat(node.finalColons) + rest;
    }

    if (node.closeLineIndex !== null && node.closeLineIndex >= 0) {
      output[node.closeLineIndex] = ':'.repeat(node.finalColons);
    }
  }

  // For orphaned closing markers (no matching open), leave as-is
  return output;
}

/**
 * Main normalization function
 */
export function normalizeDirectiveColons(markdown: string): string {
  const lines = markdown.split('\n');
  const markers: Array<DirectiveMarker & { lineIndex: number }> = [];

  // Pass 1a: Identify all markers
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseDirectiveMarker(lines[i]);
    if (parsed) {
      markers.push({ ...parsed, lineIndex: i });
    }
  }

  if (markers.length === 0) {
    return markdown;
  }

  // Pass 1b: Build tree
  const roots = buildTree(markers);

  // Pass 2: Compute final colon counts
  for (const root of roots) {
    computeFinalColons(root);
  }

  // Pass 3: Rebuild with new counts
  const output = rebuildMarkdown(lines, roots, markers);

  return output.join('\n');
}
