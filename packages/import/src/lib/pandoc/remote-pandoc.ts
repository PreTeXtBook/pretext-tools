/**
 * A pandoc engine backed by the pretext-plus-build `/pandoc/` endpoint.
 *
 * Lets a host with no local pandoc — pretext.plus in the browser, above all —
 * offer the same Word/EPUB/HTML imports the VS Code extension gets from a
 * native pandoc install. The endpoint sends `Access-Control-Allow-Origin: *`,
 * so the browser can post to it cross-origin.
 *
 * ## Two ways to authenticate
 *
 * The endpoint takes its shared secret as a `token` form field. A host may
 * either send it directly:
 *
 * ```ts
 * createRemotePandocEngine({
 *   url: "https://build.pretext.plus/pandoc/",
 *   token: buildToken,
 * });
 * ```
 *
 * …or point `url` at its own server, which forwards the request with the token
 * attached — the arrangement pretext.plus already uses for `/` and
 * `/prefigure/`, where `BUILD_TOKEN` is read from Rails' environment and never
 * reaches the page:
 *
 * ```ts
 * createRemotePandocEngine({
 *   url: "/projects/pandoc_convert",
 *   headers: { "X-CSRF-Token": csrfToken },
 *   credentials: "same-origin",
 * });
 * ```
 *
 * `token` is optional precisely so the second form carries no secret into
 * browser JavaScript.
 */
import type { ImportProjectOptions } from "../upload";
import type { ImportEngine } from "../../react/import-wizard";
import { createPandocEngine } from "./pandoc-engine";
import {
  PANDOC_ACCEPT_EXTENSIONS,
  fileExtension,
  pandocFormatForFileName,
  type PandocInputFormat,
} from "./formats";

/**
 * The server's own conversion limit is 25s, after which it answers `504`. The
 * client's limit sits above it so that in the ordinary case the server's
 * explanatory response wins the race and the user sees a real message rather
 * than a bare abort.
 */
export const DEFAULT_REMOTE_PANDOC_TIMEOUT_MS = 30_000;

export interface RemotePandocEngineOptions {
  /** Full URL of the `/pandoc/` endpoint, or of a host proxy that fronts it. */
  url: string;
  /** Shared build token, sent as the `token` form field. Omit when proxying. */
  token?: string;
  /** Extra request headers — a CSRF token, say. Never set `Content-Type`:
   * `FormData` sets it with the multipart boundary the server needs. */
  headers?: Record<string, string>;
  /** Passed through to `fetch`; use `"same-origin"` for a proxy on the host. */
  credentials?: RequestCredentials;
  /**
   * Ask for a whole document rather than a fragment. Defaults to `true`, and
   * should stay that way: the endpoint's own default is a fragment, and the
   * import pipeline needs a `<pretext>` root to lay a project out around.
   */
  standalone?: boolean;
  /** Override the pandoc reader instead of deriving it from the extension. */
  from?: PandocInputFormat;
  /** Abort after this long. Defaults to `DEFAULT_REMOTE_PANDOC_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injectable `fetch`, for tests and non-browser hosts. */
  fetchImpl?: typeof fetch;
  id?: string;
  label?: string;
  description?: string;
  acceptExtensions?: string[];
}

/**
 * Pull the useful text out of an error body.
 *
 * The endpoint answers `422` with an HTML blob — `<h2>Pandoc conversion
 * failed</h2><pre>…stderr…</pre>` — while every other failure is plain text.
 * The `<pre>` is the part worth showing.
 */
export function extractPandocErrorDetail(body: string): string {
  const pre = /<pre>([\s\S]*?)<\/pre>/i.exec(body);
  const text = pre ? pre[1] : body;
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Turn a failed response into the sentence the wizard's error screen shows.
 *
 * The statuses split into two audiences, and that split drives the wording:
 *
 * | Status  | Cause                                            | Whose problem |
 * | ------- | ------------------------------------------------ | ------------- |
 * | 400     | format the server won't accept                   | the author's  |
 * | 401/403 | bad or missing token                             | the host's    |
 * | 404     | wrong URL, or a proxy route that isn't mounted    | the host's    |
 * | 413     | upload over the server's size cap                | the author's  |
 * | 422     | pandoc failed; body is its stderr                | the author's  |
 * | 503     | the writer submodule is missing on the server    | the host's    |
 * | 504     | conversion exceeded the server's 25s limit       | the author's  |
 *
 * A misconfigured deploy is not something an author can act on, so those cases
 * say plainly that the file is fine and the service is not, rather than showing
 * "Invalid token" and leaving them to guess. The cases they *can* act on name
 * the next move instead.
 *
 * The message lands in a single `<p>` on the wizard's error screen, under a
 * heading that already says "Import failed" and beside a button that already
 * says "Try Another File" — so: no newlines, no repeating either of those, and
 * one or two sentences at most.
 */
export function describeRemotePandocFailure(
  status: number,
  body: string,
  fileName: string,
): string {
  const detail = collapse(extractPandocErrorDetail(body));
  const because = detail ? ` (${truncateDetail(detail)})` : "";

  switch (status) {
    case 400:
      // We check the extension before sending, so reaching here means the
      // server's allowlist is narrower than ours — see the drift note in
      // formats.ts — or it could not read the format after all.
      return `The pandoc server will not convert ${fileName}${because}.${builtInFallbackHint(fileName)}`;

    case 401:
    case 403:
      return `The pandoc server rejected this site's credentials, so ${fileName} was never converted. Nothing is wrong with your file — this is a configuration problem with the service, and worth reporting.${builtInFallbackHint(fileName)}`;

    case 404:
      return `The pandoc conversion service could not be found at the address this site is configured to use. Nothing is wrong with your file — this is a configuration problem worth reporting.${builtInFallbackHint(fileName)}`;

    case 413:
      return `${fileName} is too large for the pandoc server to accept. Splitting it into chapters and importing them one at a time should get through.`;

    case 422:
      // Pandoc's own stderr. Worth showing — it often names a line — but it
      // leads with plain language because it can also be a Lua trace.
      return `Pandoc could not read ${fileName}${because}. The file may be damaged, or may use features pandoc does not support.`;

    case 503:
      return `The pandoc server is running without its PreTeXt writer, so it cannot convert anything right now. Nothing is wrong with your file — this is a problem with the service, and worth reporting.${builtInFallbackHint(fileName)}`;

    case 504:
      return `Converting ${fileName} took longer than the pandoc server allows. Splitting it into chapters and importing them one at a time usually works.`;

    default: {
      // Status included here only: for the cases above it is noise, but an
      // unrecognised one is exactly what a bug report needs to carry.
      const note = detail
        ? `(HTTP ${status}: ${truncateDetail(detail)})`
        : `(HTTP ${status})`;
      return `The pandoc server could not convert ${fileName} ${note}.${builtInFallbackHint(fileName)}`;
    }
  }
}

/** Longest slice of a server detail worth putting in front of an author. */
const MAX_DETAIL_LENGTH = 300;

/** Flatten to one line: the error screen renders the message in a single `<p>`. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateDetail(detail: string): string {
  return detail.length <= MAX_DETAIL_LENGTH
    ? detail
    : `${detail.slice(0, MAX_DETAIL_LENGTH).trimEnd()}…`;
}

/**
 * Formats the built-in converter handles natively. When the remote server is
 * the one at fault, an author holding one of these is not actually stuck —
 * saying so beats leaving them at a dead end.
 */
const BUILTIN_FALLBACK_EXTENSIONS = new Set([
  ".tex",
  ".ltx",
  ".md",
  ".markdown",
]);

function builtInFallbackHint(fileName: string): string {
  return BUILTIN_FALLBACK_EXTENSIONS.has(fileExtension(fileName))
    ? " You can import this file with the built-in converter instead."
    : "";
}

/**
 * Build an `ImportEngine` that converts uploads on a remote pandoc server.
 */
export function createRemotePandocEngine(
  options: RemotePandocEngineOptions,
): ImportEngine {
  const {
    url,
    token,
    headers,
    credentials,
    standalone = true,
    from,
    timeoutMs = DEFAULT_REMOTE_PANDOC_TIMEOUT_MS,
    fetchImpl,
    id = "pandoc-remote",
    label = "Pandoc (server)",
    description = "Convert Word, OpenOffice, EPUB, HTML, reStructuredText, and more — no local install needed.",
    acceptExtensions = PANDOC_ACCEPT_EXTENSIONS,
  } = options;

  const convertToPretext = async (
    file: File,
    _importOptions: ImportProjectOptions,
  ): Promise<string> => {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") {
      throw new Error(
        "This environment has no fetch; pass fetchImpl to createRemotePandocEngine.",
      );
    }

    // The server infers the reader from the upload's extension, but only for
    // extensions it knows. Deciding here means an unsupported file is named in
    // the error instead of coming back as an opaque 400.
    const format = from ?? pandocFormatForFileName(file.name);
    if (!format) {
      throw new Error(
        `Pandoc cannot determine a format for ${file.name}. Supported extensions: ${acceptExtensions.join(", ")}.`,
      );
    }

    const body = new FormData();
    if (token) {
      body.set("token", token);
    }
    // Always an upload, never the `source` field: docx/odt/epub are zip
    // containers that a form field would corrupt, and a single code path is
    // one fewer thing to get wrong for the text formats.
    body.set("file", file, file.name);
    body.set("from", format);
    if (standalone) {
      body.set("standalone", "yes");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        body,
        headers,
        credentials,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Pandoc conversion of ${file.name} timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the pandoc server: ${detail}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        describeRemotePandocFailure(response.status, text, file.name),
      );
    }
    return text;
  };

  return createPandocEngine({
    convertToPretext,
    id,
    label,
    description,
    acceptExtensions,
  });
}
