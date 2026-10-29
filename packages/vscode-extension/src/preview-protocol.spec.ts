import { describe, expect, it } from "vitest";
import type { RenderOptions, RenderResult } from "@pretextbook/pretext-html";
import {
  createRenderServer,
  isFatalWasmError,
  isRenderRequest,
  isRenderResponse,
  isWorkerReadRequest,
  renderOptionsFrom,
  type RenderRequest,
  type RenderResponse,
} from "./preview-protocol";

const request = (id: number, extra: Partial<RenderRequest> = {}) =>
  ({
    id,
    type: "render",
    sourcePath: "/project/source/main.ptx",
    ...extra,
  }) as RenderRequest;

const result = (html: string): RenderResult =>
  ({
    html,
    target: "html",
    printouts: [],
  }) as unknown as RenderResult;

describe("message guards", () => {
  it("recognise a render request by its shape", () => {
    expect(isRenderRequest(request(1))).toBe(true);
    expect(isRenderRequest({ id: 1, type: "render" })).toBe(false);
    expect(isRenderRequest({ id: "1", type: "render", sourcePath: "x" })).toBe(
      false,
    );
    expect(isRenderRequest(null)).toBe(false);
  });

  it("recognise a render response and a read request", () => {
    expect(isRenderResponse({ id: 3, ok: false, error: "no" })).toBe(true);
    expect(isRenderResponse({ type: "read", id: 3 })).toBe(false);
    expect(
      isWorkerReadRequest({ type: "read", id: 1, kind: "asset", path: "a" }),
    ).toBe(true);
    expect(
      isWorkerReadRequest({ type: "read", id: 1, kind: "disk", path: "a" }),
    ).toBe(false);
  });
});

describe("renderOptionsFrom", () => {
  it("carries every option field across", () => {
    const options = renderOptionsFrom(
      request(1, {
        sourceContent: "<p/>",
        mainSourcePath: "/project/source/main.ptx",
        projectDir: "/project",
        publicationPath: "/project/publication/publication.ptx",
        cssTheme: "denver",
        fragment: true,
        docinfoSourcePath: "/project/source/main.ptx",
        contextSourcePath: "/project/source/main.ptx",
        sourceMap: true,
        theme: "dark",
        revealView: "scroll",
        revealTheme: "simple",
        revealZoom: 0.5,
        previewBanner: { message: "hi" },
        subtree: { file: "/project/source/main.ptx", line: 3 },
        files: { "/project/source/ch1.ptx": "<chapter/>" },
      }),
    );
    expect(options).toEqual<RenderOptions>({
      sourcePath: "/project/source/main.ptx",
      sourceContent: "<p/>",
      mainSourcePath: "/project/source/main.ptx",
      projectDir: "/project",
      publicationPath: "/project/publication/publication.ptx",
      cssTheme: "denver",
      fragment: true,
      docinfo: undefined,
      docinfoSourcePath: "/project/source/main.ptx",
      contextSourcePath: "/project/source/main.ptx",
      sourceMap: true,
      theme: "dark",
      revealView: "scroll",
      revealTheme: "simple",
      revealZoom: 0.5,
      previewBanner: { message: "hi" },
      subtree: { file: "/project/source/main.ptx", line: 3 },
      files: { "/project/source/ch1.ptx": "<chapter/>" },
    });
  });
});

describe("isFatalWasmError", () => {
  it("matches the trap signatures, through the cause chain", () => {
    expect(isFatalWasmError(new Error("memory access out of bounds"))).toBe(
      true,
    );
    const runtime = new Error("unreachable");
    runtime.name = "RuntimeError";
    expect(isFatalWasmError(runtime)).toBe(true);
    const wrapped = new Error("Render failed");
    (wrapped as { cause?: unknown }).cause = new Error("stack overflow");
    expect(isFatalWasmError(wrapped)).toBe(true);
  });

  it("leaves ordinary render errors alone", () => {
    expect(
      isFatalWasmError(new Error("Opening and ending tag mismatch: p and q")),
    ).toBe(false);
    expect(isFatalWasmError("Could not read /x.ptx")).toBe(false);
  });
});

describe("createRenderServer", () => {
  it("answers requests in order, one at a time", async () => {
    const order: string[] = [];
    const sent: RenderResponse[] = [];
    let release: (() => void) | undefined;
    const handle = createRenderServer({
      render: async (options) => {
        order.push(`start ${options.sourcePath}`);
        if (options.sourcePath === "/a") {
          await new Promise<void>((resolve) => (release = resolve));
        }
        order.push(`end ${options.sourcePath}`);
        return result(`<html>${options.sourcePath}</html>`);
      },
      send: (response) => sent.push(response),
      onFatal: () => order.push("fatal"),
      log: () => undefined,
    });
    handle(request(1, { sourcePath: "/a" }));
    handle(request(2, { sourcePath: "/b" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // /b has not started: /a holds the queue.
    expect(order).toEqual(["start /a"]);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["start /a", "end /a", "start /b", "end /b"]);
    expect(sent.map((r) => r.id)).toEqual([1, 2]);
    expect(sent[0]).toMatchObject({ ok: true, html: "<html>/a</html>" });
  });

  it("reports an error per request and only recycles on a fatal one", async () => {
    const sent: RenderResponse[] = [];
    let fatal = 0;
    const handle = createRenderServer({
      render: async (options) => {
        if (options.sourcePath === "/typo") {
          throw new Error("Opening and ending tag mismatch");
        }
        throw new Error("memory access out of bounds");
      },
      send: (response) => sent.push(response),
      onFatal: () => fatal++,
      log: () => undefined,
    });
    handle(request(1, { sourcePath: "/typo" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent[0]).toEqual({
      id: 1,
      ok: false,
      error: "Opening and ending tag mismatch",
    });
    expect(fatal).toBe(0);
    handle(request(2, { sourcePath: "/trap" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent[1]).toMatchObject({ id: 2, ok: false });
    expect(fatal).toBe(1);
  });
});
