/**
 * CLI for @pretextbook/pretext-html. Usually launched through ../cli.mjs,
 * which re-executes Node with --experimental-wasm-jspi when needed. The HTML
 * goes to stdout (or --output); diagnostics go to stderr, so the output can
 * be piped or captured by a parent process (the VS Code extension does this).
 */

import { readFile, writeFile } from "node:fs/promises";
import * as process from "node:process";
import { injectPrintPreview } from "./printout.js";
import { renderHtml, type RenderOptions } from "./renderer.js";

const USAGE = `Usage: pretext-html <source.ptx> [options]

Render a PreTeXt document to a single standalone HTML page (portable build:
one page, css/js/MathJax from CDN). No PreTeXt installation required.

Options:
  -o, --output <file>       Write HTML to a file instead of stdout
  --publication <file>      Publication file (portable html is forced on)
  --css-theme <name>        HTML theme to use when the publication file names
                            none of its own: default-modern (PreTeXt's default),
                            denver, tacoma, salem, greeley or boulder
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
  --context <file>          Complete document (e.g. main.ptx) the fragment
                            belongs to. Renders it in place, so it is numbered
                            and its cross-references resolve as in the built
                            book. Supersedes --docinfo-source
  --off-page-message <text> Tooltip on links whose target is not on the
                            previewed page, which cannot navigate in a
                            single-page preview
  --source-map <file>       Also write a JSON source map: HTML id → source
                            file/line for every element (for editor sync)
  --no-open-knowls          Leave solutions, hints and other born-hidden
                            knowls collapsed, as a real PreTeXt build does.
                            They are expanded by default, since these pages
                            are previews of work in progress
  --print-preview[=id]      Open the page in the print-preview layout: the
                            named printout paginated to a paper size, with
                            workspaces at their true height. Without an id, the
                            document's own printout is used (a lone worksheet
                            or handout), or failing that its first. The page's
                            printouts are listed on stderr
  -h, --help                Show this help
`;

interface CliArgs {
  options: RenderOptions;
  output?: string;
  docinfoPath?: string;
  sourceMapPath?: string;
  /**
   * `--print-preview`: a printout id, or `true` for "whichever printout this
   * document is about". Which one that is cannot be known until the page has
   * been rendered, so unlike the other options this one is applied afterwards
   * (see main).
   */
  printPreview?: string | true;
}

export function parseArgs(argv: string[]): CliArgs {
  let sourcePath: string | undefined;
  let output: string | undefined;
  let docinfoPath: string | undefined;
  let sourceMapPath: string | undefined;
  let printPreview: string | true | undefined;
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
      case "--css-theme":
        options.cssTheme = next();
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
      case "--no-open-knowls":
        options.openKnowls = false;
        break;
      case "--docinfo":
        docinfoPath = next();
        break;
      case "--docinfo-source":
        options.docinfoSourcePath = next();
        break;
      case "--context":
        options.contextSourcePath = next();
        break;
      case "--off-page-message":
        options.offPageMessage = next();
        break;
      case "--source-map":
        sourceMapPath = next();
        options.sourceMap = true;
        break;
      // Attached form only (--print-preview=<id>), so that a bare
      // --print-preview cannot swallow the source file as its id.
      case "--print-preview":
        printPreview = true;
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
        if (arg.startsWith("--print-preview=")) {
          printPreview = arg.slice("--print-preview=".length);
          break;
        }
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
    printPreview,
  };
}

export async function main(argv: string[]): Promise<void> {
  const { options, output, docinfoPath, sourceMapPath, printPreview } =
    parseArgs(argv);
  if (docinfoPath) {
    options.docinfo = await readFile(docinfoPath, "utf8");
  }
  const started = Date.now();
  const result = await renderHtml(options);
  const { sourceMap, printouts, rootPrintout } = result;
  let html = result.html;
  process.stderr.write(`pretext-html: rendered in ${Date.now() - started}ms\n`);
  if (printPreview !== undefined) {
    for (const printout of printouts) {
      process.stderr.write(
        `pretext-html: printout ${printout.id} - ${printout.label}\n`,
      );
    }
    const wanted =
      typeof printPreview === "string"
        ? printPreview
        : (rootPrintout ?? printouts[0]?.id);
    if (wanted) {
      process.stderr.write(`pretext-html: print preview of ${wanted}\n`);
      html = injectPrintPreview(html, wanted);
    } else {
      process.stderr.write(
        "pretext-html: --print-preview: this document has no printouts " +
          "(worksheet, handout, or project with a workspace); writing the " +
          "ordinary page.\n",
      );
    }
  }
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
