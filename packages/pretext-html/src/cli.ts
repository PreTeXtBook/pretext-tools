/**
 * CLI for @pretextbook/pretext-html. Usually launched through ../cli.mjs,
 * which re-executes Node with --experimental-wasm-jspi when needed. The HTML
 * goes to stdout (or --output); diagnostics go to stderr, so the output can
 * be piped or captured by a parent process (the VS Code extension does this).
 */

import { readFile, writeFile } from "node:fs/promises";
import * as process from "node:process";
import { renderHtml, type RenderOptions } from "./renderer.js";

const USAGE = `Usage: pretext-html <source.ptx> [options]

Render a PreTeXt document to a single standalone HTML page (portable build:
one page, css/js/MathJax from CDN). No PreTeXt installation required.

Options:
  -o, --output <file>       Write HTML to a file instead of stdout
  --publication <file>      Publication file (portable html is forced on)
  --project-dir <dir>       Directory served to the transform for xi:includes
                            (default: the source file's directory)
  --param <name=value>      Extra XSLT string parameter (repeatable)
  --xsl-dir <dir>           Use PreTeXt stylesheets from this directory
                            instead of the vendored copy
  --fragment                Allow a non-root source file: wrap the fragment
                            in a minimal <pretext> document (an <article>,
                            or a <book> for <chapter>/<part> fragments)
  --docinfo <file>          File whose contents (a <docinfo> element) are
                            injected into the wrapper in --fragment mode, so
                            the fragment keeps the project's LaTeX macros
  --docinfo-source <file>   Complete source file (e.g. main.ptx) to lift the
                            <docinfo> from for --fragment mode, resolving
                            xi:includes (used when --docinfo is not given)
  --source-map <file>       Also write a JSON source map: HTML id → source
                            file/line for every element (for editor sync)
  -h, --help                Show this help
`;

interface CliArgs {
  options: RenderOptions;
  output?: string;
  docinfoPath?: string;
  sourceMapPath?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  let sourcePath: string | undefined;
  let output: string | undefined;
  let docinfoPath: string | undefined;
  let sourceMapPath: string | undefined;
  const options: Partial<RenderOptions> = {};
  const stringParams: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case "-o":
      case "--output":
        output = next();
        break;
      case "--publication":
        options.publicationPath = next();
        break;
      case "--project-dir":
        options.projectDir = next();
        break;
      case "--xsl-dir":
        options.xslDir = next();
        break;
      case "--fragment":
        options.fragment = true;
        break;
      case "--docinfo":
        docinfoPath = next();
        break;
      case "--docinfo-source":
        options.docinfoSourcePath = next();
        break;
      case "--source-map":
        sourceMapPath = next();
        options.sourceMap = true;
        break;
      case "--param": {
        const pair = next();
        const eq = pair.indexOf("=");
        if (eq === -1) {
          throw new Error(`--param expects name=value, got: ${pair}`);
        }
        stringParams[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (sourcePath) {
          throw new Error(`Unexpected extra argument: ${arg}`);
        }
        sourcePath = arg;
    }
  }

  if (!sourcePath) {
    throw new Error("No source file given.\n\n" + USAGE);
  }
  if (Object.keys(stringParams).length > 0) {
    options.stringParams = stringParams;
  }
  return {
    options: { ...options, sourcePath },
    output,
    docinfoPath,
    sourceMapPath,
  };
}

export async function main(argv: string[]): Promise<void> {
  const { options, output, docinfoPath, sourceMapPath } = parseArgs(argv);
  if (docinfoPath) {
    options.docinfo = await readFile(docinfoPath, "utf8");
  }
  const started = Date.now();
  const { html, sourceMap } = await renderHtml(options);
  process.stderr.write(`pretext-html: rendered in ${Date.now() - started}ms\n`);
  if (sourceMapPath && sourceMap) {
    await writeFile(sourceMapPath, JSON.stringify(sourceMap, null, 2));
    process.stderr.write(`pretext-html: wrote ${sourceMapPath}\n`);
  }
  if (output) {
    await writeFile(output, html);
    process.stderr.write(`pretext-html: wrote ${output}\n`);
  } else {
    process.stdout.write(html);
  }
}
