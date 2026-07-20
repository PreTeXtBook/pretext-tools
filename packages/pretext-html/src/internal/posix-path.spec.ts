/**
 * posix-path stands in for `node:path` in the browser build, so it has to
 * agree with it on the shapes this package actually computes. Each case is
 * checked against `node:path/posix` itself rather than a hand-written
 * expectation, which is the only way to be sure the substitution is faithful.
 */

import { describe, expect, it } from "vitest";
import * as nodePosix from "node:path/posix";
import * as shim from "./posix-path.js";

const RESOLVE_CASES: string[][] = [
  ["/source/main.ptx"],
  ["/source", "main.ptx"],
  ["/source/", "./main.ptx"],
  ["/source/ch/../main.ptx"],
  ["/a/b/c", "../../d"],
  ["/source", "sub/deep/../file.ptx"],
  ["/"],
  ["/a", "/b"],
];

const DIRNAME_CASES = [
  "/source/main.ptx",
  "/source/sub/main.ptx",
  "/main.ptx",
  "/source/",
  "main.ptx",
  "/",
];

const JOIN_CASES: string[][] = [
  ["/assets", "xsl"],
  ["/assets/", "/xsl"],
  ["/assets", "xsl", "pretext-html.xsl"],
  ["/assets", ".."],
  ["a", "b"],
];

const RELATIVE_CASES: [string, string][] = [
  ["/source", "/source/main.ptx"],
  ["/source", "/source/sub/main.ptx"],
  ["/source", "/other/main.ptx"],
  ["/source", "/source"],
  ["/a/b", "/a/c/d"],
];

const NORMALIZE_CASES = [
  "/a/b/../c",
  "/a/./b",
  "/a/b/../../../c",
  "a/b/../c",
  "/",
  "/a/b/",
];

describe("posix-path", () => {
  it.each(RESOLVE_CASES)("resolve(%s, %s)", (...segments) => {
    expect(shim.resolve(...segments)).toBe(nodePosix.resolve(...segments));
  });

  it.each(DIRNAME_CASES)("dirname(%s)", (input) => {
    expect(shim.dirname(input)).toBe(nodePosix.dirname(input));
  });

  it.each(JOIN_CASES)("join(%s, %s)", (...segments) => {
    expect(shim.join(...segments)).toBe(nodePosix.join(...segments));
  });

  it.each(RELATIVE_CASES)("relative(%s, %s)", (from, to) => {
    expect(shim.relative(from, to)).toBe(nodePosix.relative(from, to));
  });

  it.each(NORMALIZE_CASES)("normalize(%s)", (input) => {
    expect(shim.normalize(input)).toBe(nodePosix.normalize(input));
  });

  it("roots a relative path at / rather than at a cwd", () => {
    // The one deliberate divergence from node:path/posix, which would resolve
    // against process.cwd(). A browser has no cwd, and a virtual path is
    // meaningless relative to one — so bare relative input roots at "/".
    expect(shim.resolve("relative/path.ptx")).toBe("/relative/path.ptx");
    expect(nodePosix.resolve("relative/path.ptx")).toBe(
      `${process.cwd()}/relative/path.ptx`,
    );
  });

  it("clamps `..` at the root, which is what makes mounts containment-safe", () => {
    // mounts.ts and xinclude.ts both rely on this: a path that tries to climb
    // out of a mount must not escape it.
    expect(shim.resolve("/mnt", "../../etc/passwd")).toBe("/etc/passwd");
    expect(shim.normalize("/../../etc/passwd")).toBe("/etc/passwd");
  });

  it("has sep matching node:path/posix", () => {
    expect(shim.sep).toBe(nodePosix.sep);
  });
});
