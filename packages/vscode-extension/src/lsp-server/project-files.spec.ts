import { describe, it, expect } from "vitest";
import {
  fromSchemaUri,
  pathToUri,
  toSchemaUri,
  uriToPath,
} from "./project-files";

const VFS = "vscode-vfs://github/PreTeXtBook/sample-book/source/main.ptx";

describe("uriToPath / pathToUri", () => {
  it("maps a non-file URI to a virtual absolute path and back", () => {
    const path = uriToPath(VFS);
    expect(path).toBe(
      "/__vfs__/vscode-vfs/github/PreTeXtBook/sample-book/source/main.ptx",
    );
    expect(pathToUri(path)).toBe(VFS);
  });

  it("keeps relative xi:include arithmetic inside the same authority", () => {
    const dir = uriToPath(VFS).replace(/\/main\.ptx$/, "");
    expect(pathToUri(`${dir}/chapters/ch1.ptx`)).toBe(
      "vscode-vfs://github/PreTeXtBook/sample-book/source/chapters/ch1.ptx",
    );
  });

  it("accepts a virtual path that came back with backslashes", () => {
    const windowsy = uriToPath(VFS).replace(/\//g, "\\");
    expect(pathToUri(windowsy)).toBe(VFS);
  });

  it("round-trips a file: URI through the real filesystem path", () => {
    const uri = "file:///home/me/book/source/main.ptx";
    const path = uriToPath(uri);
    expect(path.replace(/\\/g, "/")).toMatch(
      /\/home\/me\/book\/source\/main\.ptx$/,
    );
    expect(pathToUri(path)).toBe(uri);
  });
});

describe("toSchemaUri / fromSchemaUri", () => {
  it("passes file: URIs through untouched", () => {
    const uri = "file:///home/me/book/source/main.ptx";
    expect(toSchemaUri(uri)).toBe(uri);
    expect(fromSchemaUri(uri)).toBe(uri);
  });

  it("gives the schema package the bare virtual path, and undoes it", () => {
    const schemaUri = toSchemaUri(VFS);
    expect(schemaUri).toBe(
      "/__vfs__/vscode-vfs/github/PreTeXtBook/sample-book/source/main.ptx",
    );
    expect(fromSchemaUri(schemaUri)).toBe(VFS);
  });

  it("undoes the mapping when Node's win32 path.resolve added a drive letter", () => {
    expect(
      fromSchemaUri(
        "file:///c%3A/__vfs__/vscode-vfs/github/PreTeXtBook/sample-book/source/ch1.ptx",
      ),
    ).toBe("vscode-vfs://github/PreTeXtBook/sample-book/source/ch1.ptx");
    expect(
      pathToUri(
        "C:\\__vfs__\\vscode-vfs\\github\\PreTeXtBook\\sample-book\\source\\ch1.ptx",
      ),
    ).toBe("vscode-vfs://github/PreTeXtBook/sample-book/source/ch1.ptx");
  });

  it("undoes the mapping on URIs the schema package builds for included files", () => {
    // The browser build of @pretextbook/schema makes these with
    // encodeURIComponent per segment.
    const reported =
      "file:///__vfs__/vscode-vfs/github/PreTeXtBook/sample-book/source/ch1.ptx";
    expect(fromSchemaUri(reported)).toBe(
      "vscode-vfs://github/PreTeXtBook/sample-book/source/ch1.ptx",
    );
  });
});
