import { execFile, execSync } from "child_process";
import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Location of the pandoc → PreTeXt custom writer on disk. */
export const pretextLuaPath = path.join(
  homedir(),
  ".ptx",
  "pandoc",
  "pretext.lua",
);

const PRETEXT_LUA_URL =
  "https://raw.githubusercontent.com/oscarlevin/pandoc-pretext/master/pretext.lua";

// pretext.lua must be at least this recent; older copies are re-downloaded.
const PRETEXT_LUA_MIN_DATE = new Date("2026-07-14");

/** True when a usable pandoc (v2 or v3) is on the PATH. */
export function pandocInstalled(): boolean {
  try {
    return /pandoc\s(2\.|3\.)/.test(execSync("pandoc --version").toString());
  } catch {
    return false;
  }
}

/**
 * Ensure a recent pretext.lua custom writer is present, downloading it if it
 * is missing or outdated. Resolves with the path to the writer.
 */
export async function ensurePretextLua(): Promise<string> {
  const stat = fs.existsSync(pretextLuaPath)
    ? fs.statSync(pretextLuaPath)
    : null;
  if (stat && stat.mtime >= PRETEXT_LUA_MIN_DATE) {
    return pretextLuaPath;
  }
  const dir = path.dirname(pretextLuaPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await downloadFile(PRETEXT_LUA_URL, pretextLuaPath);
  return pretextLuaPath;
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          reject(
            new Error(`Failed to download ${url}: HTTP ${response.statusCode}`),
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (err) => {
        file.close();
        fs.rm(destination, { force: true }, () => reject(err));
      });
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
