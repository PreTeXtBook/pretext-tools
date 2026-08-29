import { describe, expect, it, vi } from "vitest";
import {
  createRemotePandocEngine,
  describeRemotePandocFailure,
  extractPandocErrorDetail,
} from "./remote-pandoc";

const PRETEXT = `<pretext><article><title>Notes</title><section><title>One</title><p>Hi.</p></section></article></pretext>`;

function okFetch(body = PRETEXT) {
  return vi.fn(async () => new Response(body, { status: 200 }));
}

function docx(name = "notes.docx"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name);
}

describe("createRemotePandocEngine", () => {
  it("posts the file, token, reader and standalone flag", async () => {
    const fetchImpl = okFetch();
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      token: "s3cret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await engine.convertFile(docx(), {});

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://build.example/pandoc/");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("token")).toBe("s3cret");
    expect(body.get("from")).toBe("docx");
    // The endpoint defaults to a fragment; the import pipeline needs a root.
    expect(body.get("standalone")).toBe("yes");
    expect((body.get("file") as File).name).toBe("notes.docx");
  });

  it("omits the token when the host proxies instead", async () => {
    const fetchImpl = okFetch();
    const engine = createRemotePandocEngine({
      url: "/projects/pandoc_convert",
      headers: { "X-CSRF-Token": "abc" },
      credentials: "same-origin",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await engine.convertFile(docx(), {});

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).has("token")).toBe(false);
    expect(init.headers).toEqual({ "X-CSRF-Token": "abc" });
    expect(init.credentials).toBe("same-origin");
  });

  it("lays the converted PreTeXt out as a project named after the upload", async () => {
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      fetchImpl: okFetch() as unknown as typeof fetch,
    });

    const result = await engine.convertFile(docx("Chapter One.docx"), {});

    expect("pretextError" in result).toBe(false);
    if ("pretextError" in result) return;
    expect(result.sourceName).toBe("Chapter One.docx");
    expect(result.sourcePath).toBe("Chapter One.docx");
    expect(Object.keys(result.outputFiles)).toContain("project.ptx");
  });

  it("rejects an extension pandoc has no reader for, without a request", async () => {
    const fetchImpl = okFetch();
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(engine.convertFile(docx("book.pdf"), {})).rejects.toThrow(
      /cannot determine a format for book\.pdf/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces pandoc's stderr from a 422", async () => {
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      fetchImpl: (async () =>
        new Response(
          "<h2>Pandoc conversion failed</h2>\n<pre>\nError at &quot;input.tex&quot; line 3\n</pre>",
          { status: 422 },
        )) as unknown as typeof fetch,
    });

    await expect(engine.convertFile(docx("notes.tex"), {})).rejects.toThrow(
      /Error at "input\.tex" line 3/,
    );
  });

  it("reports a timeout in seconds rather than an abort", async () => {
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch,
    });

    await expect(engine.convertFile(docx(), {})).rejects.toThrow(
      /timed out after/,
    );
  });

  it("treats empty output as a failure rather than an empty project", async () => {
    const engine = createRemotePandocEngine({
      url: "https://build.example/pandoc/",
      fetchImpl: okFetch("   \n") as unknown as typeof fetch,
    });

    await expect(engine.convertFile(docx(), {})).rejects.toThrow(
      /produced no output/,
    );
  });
});

describe("extractPandocErrorDetail", () => {
  it("unwraps the <pre> and decodes entities", () => {
    expect(
      extractPandocErrorDetail(
        "<h2>Nope</h2>\n<pre>\na &amp; b &lt;c&gt;\n</pre>",
      ),
    ).toBe("a & b <c>");
  });

  it("passes a plain-text body through", () => {
    expect(extractPandocErrorDetail("Invalid token")).toBe("Invalid token");
  });
});

describe("describeRemotePandocFailure", () => {
  it("leads with plain language on a 422, keeping pandoc's stderr as detail", () => {
    const message = describeRemotePandocFailure(
      422,
      "<h2>Pandoc conversion failed</h2>\n<pre>\nError at line 3\n</pre>",
      "notes.docx",
    );
    expect(message).toMatch(/^Pandoc could not read notes\.docx/);
    expect(message).toContain("Error at line 3");
  });

  it("tells the author a misconfigured service is not their file's fault", () => {
    for (const status of [401, 403, 404, 503]) {
      const message = describeRemotePandocFailure(
        status,
        "Invalid token",
        "notes.docx",
      );
      expect(message).toContain("Nothing is wrong with your file");
      // The raw body is a deployment detail an author cannot act on.
      expect(message).not.toContain("Invalid token");
    }
  });

  it("names the next move on the statuses an author can act on", () => {
    expect(describeRemotePandocFailure(504, "", "book.docx")).toMatch(
      /Splitting it into chapters/,
    );
    expect(describeRemotePandocFailure(413, "", "book.docx")).toMatch(
      /too large/,
    );
  });

  it("offers the built-in converter only for formats it handles", () => {
    const hint = "built-in converter";
    expect(describeRemotePandocFailure(503, "", "notes.tex")).toContain(hint);
    expect(describeRemotePandocFailure(503, "", "notes.md")).toContain(hint);
    // Pandoc is the only path for these, so the hint would be a dead end.
    expect(describeRemotePandocFailure(503, "", "notes.docx")).not.toContain(
      hint,
    );
  });

  it("keeps the message to one line and carries an unknown status for bug reports", () => {
    const message = describeRemotePandocFailure(
      418,
      "something\nsplit\nover lines",
      "notes.docx",
    );
    expect(message).toContain("HTTP 418");
    expect(message).not.toContain("\n");
    expect(message).toContain("something split over lines");
  });

  it("truncates a runaway stderr rather than flooding the error screen", () => {
    const message = describeRemotePandocFailure(
      422,
      `<pre>${"x".repeat(2000)}</pre>`,
      "notes.docx",
    );
    expect(message.length).toBeLessThan(450);
    expect(message).toContain("\u2026");
  });
});
