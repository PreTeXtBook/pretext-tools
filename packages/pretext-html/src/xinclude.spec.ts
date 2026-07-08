import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveXIncludes } from "./xinclude.js";

describe("resolveXIncludes", () => {
  let dir: string;

  const write = (rel: string, content: string) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "xinclude-test-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a nested chain of includes across directories", async () => {
    write(
      "chapters/ch1.ptx",
      `<chapter xmlns:xi="http://www.w3.org/2001/XInclude" xml:id="ch1">
        <xi:include href="./sections/sec1.ptx"/>
      </chapter>`,
    );
    write("chapters/sections/sec1.ptx", `<section><p>Deep text.</p></section>`);
    const main = write(
      "main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
        <book><xi:include href="chapters/ch1.ptx"/></book>
      </pretext>`,
    );
    const result = await resolveXIncludes(
      fs.readFileSync(main, "utf8"),
      main,
      dir,
    );
    expect(result).toContain("Deep text.");
    expect(result).not.toContain("xi:include");
  });

  it("handles parse='text' includes", async () => {
    write("code.py", `print("a < b")`);
    const main = write(
      "text-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
        <program><xi:include href="code.py" parse="text"/></program>
      </pretext>`,
    );
    const result = await resolveXIncludes(
      fs.readFileSync(main, "utf8"),
      main,
      dir,
    );
    expect(result).toContain(`print("a &#x3C; b")`);
  });

  it("uses xi:fallback when the target is missing", async () => {
    const main = write(
      "fallback-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
        <xi:include href="missing.ptx">
          <xi:fallback><p>Fallback content.</p></xi:fallback>
        </xi:include>
      </pretext>`,
    );
    const result = await resolveXIncludes(
      fs.readFileSync(main, "utf8"),
      main,
      dir,
    );
    expect(result).toContain("Fallback content.");
  });

  it("errors on a missing target without fallback", async () => {
    const main = write(
      "missing-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
        <xi:include href="nope.ptx"/>
      </pretext>`,
    );
    await expect(
      resolveXIncludes(fs.readFileSync(main, "utf8"), main, dir),
    ).rejects.toThrow(/target not found: nope.ptx/);
  });

  it("detects circular includes", async () => {
    write(
      "a.ptx",
      `<a xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="b.ptx"/></a>`,
    );
    write(
      "b.ptx",
      `<b xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="a.ptx"/></b>`,
    );
    const main = write(
      "cycle-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="a.ptx"/></pretext>`,
    );
    await expect(
      resolveXIncludes(fs.readFileSync(main, "utf8"), main, dir),
    ).rejects.toThrow(/Circular xi:include/);
  });

  it("refuses includes that escape the project directory", async () => {
    const main = write(
      "escape-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="../../etc/passwd"/></pretext>`,
    );
    await expect(
      resolveXIncludes(fs.readFileSync(main, "utf8"), main, dir),
    ).rejects.toThrow(/escapes the project directory/);
  });

  it("rejects xpointer includes with a clear error", async () => {
    write("frag.ptx", `<x><y xml:id="part"/></x>`);
    const main = write(
      "xpointer-main.ptx",
      `<pretext xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="frag.ptx" xpointer="part"/></pretext>`,
    );
    await expect(
      resolveXIncludes(fs.readFileSync(main, "utf8"), main, dir),
    ).rejects.toThrow(/xpointer is not supported/);
  });

  it("honors non-xi prefixes bound to the XInclude namespace", async () => {
    write("other.ptx", `<p>Other prefix works.</p>`);
    const main = write(
      "prefix-main.ptx",
      `<pretext xmlns:inc="http://www.w3.org/2001/XInclude"><inc:include href="other.ptx"/></pretext>`,
    );
    const result = await resolveXIncludes(
      fs.readFileSync(main, "utf8"),
      main,
      dir,
    );
    expect(result).toContain("Other prefix works.");
  });

  it("leaves sources without includes untouched", async () => {
    const content = `<pretext><article xml:id="a"><p>Nothing to include.</p></article></pretext>`;
    const result = await resolveXIncludes(
      content,
      path.join(dir, "no-includes.ptx"),
      dir,
    );
    expect(result).toBe(content);
  });
});
