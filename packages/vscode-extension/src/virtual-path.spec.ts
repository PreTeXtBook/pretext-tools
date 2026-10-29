import { describe, it, expect } from "vitest";
import { pathToUri, uriToPath, VFS_PREFIX } from "./virtual-path";

describe("virtual paths for URIs the plain encoding cannot carry", () => {
  it("round-trips an untitled document (no authority, no leading slash)", () => {
    const uri = "untitled:Untitled-1";
    const path = uriToPath(uri);
    expect(path.startsWith(VFS_PREFIX)).toBe(true);
    expect(pathToUri(path)).toBe(uri);
  });

  it("round-trips a git: diff document, query and all", () => {
    const uri =
      "git:/c%3A/Users/me/book/source/main.ptx?%7B%22path%22%3A%22c%3A%5C%5CUsers%5C%5Cme%5C%5Cbook%5C%5Csource%5C%5Cmain.ptx%22%2C%22ref%22%3A%22~%22%7D";
    const path = uriToPath(uri);
    // The query holds backslashes and slashes; neither may leak into the
    // path, where a backslash is read as a separator.
    expect(path).not.toContain("\\");
    expect(pathToUri(path)).toBe(uri);
  });

  it("keeps a git: document apart from the working-tree file", () => {
    const working = uriToPath("file:///c%3A/Users/me/book/source/main.ptx");
    const diff = uriToPath(
      "git:/c%3A/Users/me/book/source/main.ptx?%7B%22ref%22%3A%22~%22%7D",
    );
    expect(diff).not.toBe(working);
  });

  it("round-trips a fragment", () => {
    const uri = "vscode-vfs://github/owner/repo/source/main.ptx#sec-1";
    expect(pathToUri(uriToPath(uri))).toBe(uri);
  });

  it("survives path normalisation collapsing a double slash", () => {
    // An empty authority used to be written as nothing between two slashes,
    // which path.resolve folds away.
    const path = uriToPath("untitled:/scratch/notes.ptx");
    expect(path).not.toContain("//");
    expect(pathToUri(path)).toBe("untitled:/scratch/notes.ptx");
  });

  it("still gives vscode-vfs documents the plain spelling", () => {
    expect(uriToPath("vscode-vfs://github/owner/repo/source/main.ptx")).toBe(
      "/__vfs__/vscode-vfs/github/owner/repo/source/main.ptx",
    );
  });
});
