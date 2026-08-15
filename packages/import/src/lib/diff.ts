// A minimal line diff, for showing what cleaning did to a file.
//
// Deliberately not a dependency: the only consumer is the import wizard's
// before/after view, the inputs are one division each, and the repo already
// prefers small hand-rolled helpers over dependencies for this kind of thing
// (cf. the tar reader in `upload.ts`).

export type DiffOp = "keep" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the "before" text; absent for added lines. */
  beforeLine?: number;
  /** 1-based line number in the "after" text; absent for removed lines. */
  afterLine?: number;
}

export interface DiffHunk {
  /** Lines in this hunk, including the surrounding context. */
  lines: DiffLine[];
}

export interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Longest common subsequence of two line arrays, as a diff.
 *
 * The classic O(n·m) dynamic program. A division is at most a few thousand
 * lines, so the table is small enough not to matter; anything larger is guarded
 * by `MAX_DIFF_LINES` below, which falls back to a whole-file replacement
 * rather than allocating a table nobody will read.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length === 0 ? [] : before.split("\n");
  const b = after.length === 0 ? [] : after.split("\n");

  if (a.length + b.length > MAX_DIFF_LINES) {
    return [
      ...a.map(
        (text, i): DiffLine => ({ op: "remove", text, beforeLine: i + 1 }),
      ),
      ...b.map((text, i): DiffLine => ({ op: "add", text, afterLine: i + 1 })),
    ];
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({
        op: "keep",
        text: a[i],
        beforeLine: i + 1,
        afterLine: j + 1,
      });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ op: "remove", text: a[i], beforeLine: i + 1 });
      i++;
    } else {
      lines.push({ op: "add", text: b[j], afterLine: j + 1 });
      j++;
    }
  }
  while (i < a.length)
    lines.push({ op: "remove", text: a[i], beforeLine: ++i });
  while (j < b.length) lines.push({ op: "add", text: b[j], afterLine: ++j });

  return lines;
}

/** Above this combined line count, the LCS table is not worth building. */
export const MAX_DIFF_LINES = 20_000;

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === "add") added++;
    else if (line.op === "remove") removed++;
  }
  return { added, removed };
}

/**
 * Group a diff into hunks of changed lines with `context` unchanged lines
 * around each, dropping the long runs of untouched text between them. A
 * cleaning pass usually touches a handful of scattered lines, so showing the
 * whole file would bury them.
 */
export function diffHunks(lines: DiffLine[], context = 2): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.op === "keep" ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(lines.length - 1, changed[0] + context);

  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(lines.length - 1, index + context);
      continue;
    }
    hunks.push({ lines: lines.slice(start, end + 1) });
    start = Math.max(0, index - context);
    end = Math.min(lines.length - 1, index + context);
  }
  hunks.push({ lines: lines.slice(start, end + 1) });

  return hunks;
}
