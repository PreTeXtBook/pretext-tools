import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { Readable } from "stream";

// The writer is a directory, not a script: pretext.lua `dofile`s
// pretext-environments.lua from beside itself. These tests pin that the
// installer treats it that way — the original only fetched the entry point,
// and every conversion died on the missing companion.

const requested: string[] = [];
let respond: (url: string) => { status: number; body: string };

vi.mock("https", () => {
  const get = (url: string, callback: (response: unknown) => void) => {
    requested.push(url);
    const { status, body } = respond(url);
    const response = Readable.from([body]) as Readable & {
      statusCode: number;
    };
    response.statusCode = status;
    setImmediate(() => callback(response));
    return new EventEmitter();
  };
  return { get, default: { get } };
});

let home: string;
let writerDir: string;

/** Import `pandoc.ts` fresh, so it reads the redirected HOME. */
async function loadPandocModule() {
  vi.resetModules();
  return import("./pandoc");
}

function writeWriterFile(name: string, contents: string, mtime = new Date()) {
  const target = path.join(writerDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  fs.utimesSync(target, mtime, mtime);
}

beforeEach(() => {
  requested.length = 0;
  respond = (url) => ({ status: 200, body: `-- ${path.basename(url)}\n` });
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ptx-pandoc-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  writerDir = path.join(home, ".ptx", "pandoc");
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("ensurePretextLua", () => {
  it("downloads every file the writer needs, not just its entry point", async () => {
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(fs.readdirSync(writerDir).sort()).toEqual([
      "pretext-environments.lua",
      "pretext.lua",
    ]);
  });

  it("fetches from the branch that exists, not the renamed one", async () => {
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(requested).toHaveLength(2);
    for (const url of requested) {
      expect(url).toContain("/pandoc-pretext/main/");
      expect(url).not.toContain("/master/");
    }
  });

  it("repairs an install whose entry point is current but companion is missing", async () => {
    // Exactly the broken state a pre-companion install leaves behind: nothing
    // about pretext.lua's own age reveals that the directory is incomplete.
    writeWriterFile("pretext.lua", "-- current\n");
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(requested).toHaveLength(2);
    expect(
      fs.existsSync(path.join(writerDir, "pretext-environments.lua")),
    ).toBe(true);
  });

  it("treats a zero-length file as absent", async () => {
    writeWriterFile("pretext.lua", "-- current\n");
    writeWriterFile("pretext-environments.lua", "");
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(
      fs.statSync(path.join(writerDir, "pretext-environments.lua")).size,
    ).toBeGreaterThan(0);
  });

  it("re-downloads a writer older than the minimum date", async () => {
    const stale = new Date("2020-01-01");
    writeWriterFile("pretext.lua", "-- old\n", stale);
    writeWriterFile("pretext-environments.lua", "-- old\n", stale);
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(requested).toHaveLength(2);
    expect(
      fs.readFileSync(path.join(writerDir, "pretext.lua"), "utf8"),
    ).not.toBe("-- old\n");
  });

  it("makes no request when the writer is complete and current", async () => {
    writeWriterFile("pretext.lua", "-- current\n");
    writeWriterFile("pretext-environments.lua", "-- current\n");
    const { ensurePretextLua } = await loadPandocModule();

    await ensurePretextLua();

    expect(requested).toEqual([]);
  });

  it("leaves no partial file behind when a download fails", async () => {
    respond = (url) =>
      url.endsWith("pretext-environments.lua")
        ? { status: 404, body: "Not Found" }
        : { status: 200, body: "-- writer\n" };
    const { ensurePretextLua } = await loadPandocModule();

    await expect(ensurePretextLua()).rejects.toThrow(/HTTP 404/);
    // A staged file that never completed must not be left where the freshness
    // check would later trust it.
    expect(
      fs.existsSync(path.join(writerDir, "pretext-environments.lua")),
    ).toBe(false);
    expect(
      fs.readdirSync(writerDir).filter((name) => name.includes(".part-")),
    ).toEqual([]);
  });
});
