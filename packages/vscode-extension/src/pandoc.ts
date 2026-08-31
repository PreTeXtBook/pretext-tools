import { execFile, execSync } from "child_process";
import * as os from "os";
import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Directory holding our copy of the pandoc → PreTeXt custom writer. */
export const pandocPretextDir = path.join(homedir(), ".ptx", "pandoc");

/** Location of the pandoc → PreTeXt custom writer on disk. */
export const pretextLuaPath = path.join(pandocPretextDir, "pretext.lua");

/**
 * Every file the writer needs, not just its entry point.
 *
 * `pretext.lua` resolves its own directory at load time and `dofile`s
 * `pretext-environments.lua` from beside itself, so the writer is a *directory*
 * rather than a single script. Downloading only the entry point leaves pandoc
 * dying with "cannot open .../pretext-environments.lua" on every conversion.
 *
 * Add `pretext-latex-reader.lua` here if the `-f` reader is ever wired up; it
 * loads the same companion.
 */
const PRETEXT_WRITER_FILES = ["pretext.lua", "pretext-environments.lua"];

// The repository's default branch is `main`; it has no `master`. Raw requests
// for `master` are currently answered through GitHub's branch-rename redirect,
// which is a courtesy we should not depend on.
const PRETEXT_LUA_BASE_URL =
  "https://raw.githubusercontent.com/oscarlevin/pandoc-pretext/main/";

// The writer must be at least this recent; older copies are re-downloaded.
// Bump this when upstream changes in a way users need straight away.
const PRETEXT_LUA_MIN_DATE = new Date("2026-08-28");

/** True when a usable pandoc (v2 or v3) is on the PATH. */
export function pandocInstalled(): boolean {
  try {
    return /pandoc\s(2\.|3\.)/.test(execSync("pandoc --version").toString());
  } catch {
    return false;
  }
}

/**
 * Is every file of the writer present and recent enough to use?
 *
 * Checked across the whole file list rather than the entry point alone. When
 * upstream grows a new companion, an install that predates it has a perfectly
 * fresh `pretext.lua` and is still broken — so presence, not just age, has to
 * be part of the test. Zero-length files are treated as absent: that is what a
 * download interrupted before the rename would leave behind.
 */
function pretextWriterIsCurrent(): boolean {
  return PRETEXT_WRITER_FILES.every((name) => {
    try {
      const stat = fs.statSync(path.join(pandocPretextDir, name));
      return stat.size > 0 && stat.mtime >= PRETEXT_LUA_MIN_DATE;
    } catch {
      return false;
    }
  });
}

/**
 * Ensure a recent, complete copy of the pandoc → PreTeXt custom writer is
 * present, downloading it if any part is missing or outdated. Resolves with the
 * path to the writer's entry point.
 */
export async function ensurePretextLua(): Promise<string> {
  if (pretextWriterIsCurrent()) {
    return pretextLuaPath;
  }
  await fs.promises.mkdir(pandocPretextDir, { recursive: true });
  // All or nothing: a half-updated directory can mix a new writer with an old
  // companion, which fails in ways far harder to read than a missing file.
  await Promise.all(
    PRETEXT_WRITER_FILES.map((name) =>
      downloadFile(
        `${PRETEXT_LUA_BASE_URL}${name}`,
        path.join(pandocPretextDir, name),
      ),
    ),
  );
  return pretextLuaPath;
}

/**
 * Download one file, replacing the destination only once it has arrived whole.
 *
 * Writing straight to the destination is what makes a failed download
 * poisonous: the truncated file lands with a fresh mtime, so the freshness
 * check above then trusts it forever and every conversion fails. Staging beside
 * it and renaming means the destination only ever holds a complete file.
 */
function downloadFile(url: string, destination: string): Promise<void> {
  const staging = `${destination}.part-${process.pid}`;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(staging);
    const fail = (error: Error) => {
      file.close();
      fs.rm(staging, { force: true }, () => reject(error));
    };
    https
      .get(url, (response) => {
        // Anything but 200 — a redirect included, since `https.get` does not
        // follow them and would otherwise pipe the redirect body to disk.
        if (response.statusCode !== 200) {
          response.resume();
          fail(
            new Error(`Failed to download ${url}: HTTP ${response.statusCode}`),
          );
          return;
        }
        response.pipe(file);
        response.on("error", fail);
        file.on("error", fail);
        file.on("finish", () =>
          file.close(() =>
            fs.promises.rename(staging, destination).then(resolve, fail),
          ),
        );
      })
      .on("error", fail);
  });
}

/**
 * Convert a source file to a standalone PreTeXt document using pandoc's custom
 * pretext.lua writer. Assumes pandoc is installed (guard with
 * `pandocInstalled()`); ensures the writer is present first.
 */
export async function pandocToPretext(inputPath: string): Promise<string> {
  const writer = await ensurePretextLua();
  const { stdout } = await execFileAsync(
    "pandoc",
    [inputPath, "-t", writer, "-s"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

export interface PandocConversion {
  pretext: string;
  /** Extracted media, keyed by a path relative to the extraction directory. */
  media: Record<string, Uint8Array>;
}

/** Every file under `dir`, keyed by its path relative to `dir`. */
async function readTree(
  dir: string,
  prefix = "",
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(out, await readTree(full, rel));
    } else if (entry.isFile()) {
      out[rel] = new Uint8Array(await fs.promises.readFile(full));
    }
  }
  return out;
}

/**
 * Convert with pandoc and carry the document's own figures out with it.
 *
 * A Word or EPUB file holds its images inside the container, so a conversion
 * that only takes the text silently drops every figure. `--extract-media`
 * unpacks them beside the output, which only the local binary can do — the
 * remote `/pandoc/` endpoint answers `text/plain` and has nowhere to put them
 * (packages/import/SPEC.md §9.7).
 *
 * Extraction failing is not worth failing the conversion over: the text is the
 * greater part of it, and the import warns about images it cannot find.
 */
export async function pandocToPretextWithMedia(
  inputPath: string,
): Promise<PandocConversion> {
  const writer = await ensurePretextLua();
  const mediaDir = path.join(os.tmpdir(), `ptx-media-${Date.now()}`);
  try {
    const { stdout } = await execFileAsync(
      "pandoc",
      [inputPath, "-t", writer, "-s", `--extract-media=${mediaDir}`],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    let media: Record<string, Uint8Array> = {};
    try {
      media = await readTree(mediaDir);
    } catch {
      // No media directory: the document had no embedded figures.
    }
    return { pretext: stdout, media };
  } finally {
    await fs.promises
      .rm(mediaDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
