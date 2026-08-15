import { describe, expect, it } from "vitest";
import { diffHunks, diffLines, diffStats } from "./diff";

const ops = (before: string, after: string) =>
  diffLines(before, after).map((l) => `${l.op}:${l.text}`);

describe("diffLines", () => {
  it("reports identical text as all keeps", () => {
    expect(ops("a\nb", "a\nb")).toEqual(["keep:a", "keep:b"]);
  });

  it("reports a replaced line as a remove then an add", () => {
    expect(ops("a\nb\nc", "a\nX\nc")).toEqual([
      "keep:a",
      "remove:b",
      "add:X",
      "keep:c",
    ]);
  });

  it("reports a pure deletion", () => {
    expect(ops("a\nb\nc", "a\nc")).toEqual(["keep:a", "remove:b", "keep:c"]);
  });

  it("reports a pure insertion", () => {
    expect(ops("a\nc", "a\nb\nc")).toEqual(["keep:a", "add:b", "keep:c"]);
  });

  it("handles an empty before", () => {
    expect(ops("", "a")).toEqual(["add:a"]);
  });

  it("handles an empty after", () => {
    expect(ops("a", "")).toEqual(["remove:a"]);
  });

  it("numbers lines against their own side", () => {
    const lines = diffLines("a\nb\nc", "a\nX\nc");
    expect(lines[1]).toMatchObject({ op: "remove", beforeLine: 2 });
    expect(lines[2]).toMatchObject({ op: "add", afterLine: 2 });
    expect(lines[3]).toMatchObject({ op: "keep", beforeLine: 3, afterLine: 3 });
  });

  it("finds the longest common subsequence, not just a prefix", () => {
    expect(ops("x\na\nb\nc\ny", "a\nb\nc")).toEqual([
      "remove:x",
      "keep:a",
      "keep:b",
      "keep:c",
      "remove:y",
    ]);
  });

  it("keeps every original line accounted for", () => {
    const before = "one\ntwo\nthree\nfour";
    const after = "one\ntwo prime\nfour";
    const lines = diffLines(before, after);
    const reconstructed = lines
      .filter((l) => l.op !== "add")
      .map((l) => l.text)
      .join("\n");
    expect(reconstructed).toBe(before);
    const rebuilt = lines
      .filter((l) => l.op !== "remove")
      .map((l) => l.text)
      .join("\n");
    expect(rebuilt).toBe(after);
  });
});

describe("diffStats", () => {
  it("counts additions and removals", () => {
    expect(diffStats(diffLines("a\nb\nc", "a\nX\nY\nc"))).toEqual({
      added: 2,
      removed: 1,
    });
  });
});

describe("diffHunks", () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");

  it("returns nothing when there are no changes", () => {
    expect(diffHunks(diffLines(long, long))).toEqual([]);
  });

  it("shows context around an isolated change", () => {
    const changed = long.replace("line 20", "LINE 20");
    const hunks = diffHunks(diffLines(long, changed), 2);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((l) => l.text)).toEqual([
      "line 18",
      "line 19",
      "line 20",
      "LINE 20",
      "line 21",
      "line 22",
    ]);
  });

  it("splits distant changes into separate hunks", () => {
    const changed = long.replace("line 5", "L5").replace("line 30", "L30");
    expect(diffHunks(diffLines(long, changed), 2)).toHaveLength(2);
  });

  it("merges nearby changes into one hunk", () => {
    const changed = long.replace("line 5", "L5").replace("line 7", "L7");
    expect(diffHunks(diffLines(long, changed), 2)).toHaveLength(1);
  });
});
