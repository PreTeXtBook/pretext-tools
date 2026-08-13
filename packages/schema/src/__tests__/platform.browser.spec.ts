import { describe, expect, it } from "vitest";
import * as nodePath from "node:path";
import {
  fileURLToPath as nodeFileURLToPath,
  pathToFileURL as nodePathToFileURL,
} from "node:url";
import {
  dirname,
  isAbsolute,
  resolve,
  fileURLToPath,
  pathToFileURL,
  readFileUtf8,
} from "../platform.browser";

describe("platform.browser", () => {
  it("dirname matches node:path.posix for virtual posix paths", () => {
    for (const p of ["/a/b/c.ptx", "/a", "/", "a/b.ptx", "b.ptx"]) {
      expect(dirname(p)).toBe(nodePath.posix.dirname(p));
    }
  });

  it("isAbsolute matches node:path.posix", () => {
    expect(isAbsolute("/a/b")).toBe(nodePath.posix.isAbsolute("/a/b"));
    expect(isAbsolute("a/b")).toBe(nodePath.posix.isAbsolute("a/b"));
  });

  it("resolve matches node:path.posix.resolve when rooted at /", () => {
    expect(resolve("/a/b", "../c.ptx")).toBe(
      nodePath.posix.resolve("/a/b", "../c.ptx"),
    );
    expect(resolve("/a/b", "c.ptx")).toBe(
      nodePath.posix.resolve("/a/b", "c.ptx"),
    );
    expect(resolve("/main.ptx")).toBe("/main.ptx");
  });

  it("fileURLToPath/pathToFileURL round-trip and match node:url", () => {
    const p = "/a/b c.ptx";
    expect(pathToFileURL(p)).toBe(nodePathToFileURL(p).toString());
    expect(fileURLToPath(pathToFileURL(p))).toBe(
      nodeFileURLToPath(nodePathToFileURL(p).toString()),
    );
  });

  it("readFileUtf8 throws: there is no filesystem in the browser build", () => {
    expect(() => readFileUtf8("/a.ptx")).toThrow(/no filesystem/);
  });
});
