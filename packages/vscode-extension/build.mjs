// Build all parts of the plugin
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

function statusUpdateFunction(entry, outfile) {
  return (result) => {
    if (result) {
      console.log("Built", entry, " to ", outfile);
    }
  };
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`
        );
      });
      console.log("[watch] build finished");
    });
  },
};

const extensionCompiled = statusUpdateFunction(
  "./src/extension.ts",
  "./out/extension.js"
);
const lspServerCompiled = statusUpdateFunction(
  "./src/lsp-server/main.ts",
  "./out/lsp-server.js"
);

const buildOptions = {
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  external: ["vscode", "@pretextbook/format"],
  outfile: "../../dist/vscode-extension/out/extension.js",
  plugins: [esbuildProblemMatcherPlugin],
};

const buildOptionsLSP = {
  entryPoints: ["./src/lsp-server/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  external: ["vscode", "@pretextbook/format"],
  outfile: "../../dist/vscode-extension/out/lsp-server.js",
  plugins: [esbuildProblemMatcherPlugin],
};

const ctx = await esbuild.context({ ...buildOptions });

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
}
await ctx.dispose();

const ctxLSP = await esbuild.context({ ...buildOptionsLSP });

if (watch) {
  await ctxLSP.watch();
} else {
  await ctxLSP.rebuild();
}
await ctxLSP.dispose();

// Compile the base extension
//const result = await esbuild
//  .build({
//    entryPoints: ["./src/extension.ts"],
//    bundle: true,
//    format: "cjs",
//    platform: "node",
//    sourcemap: true,
//    external: ["vscode", "vscode*", "file"],
//    outfile: "./out/extension.js",
//    watch: WATCH && {
//      onRebuild(error, result) {
//        if (error) {
//          console.warn("Encountered build error", e);
//        }
//        extensionCompiled(result);
//      },
//    },
//  })
//  .then((result) => {
//    extensionCompiled(result);
//  })
//  .catch((e) => {
//    console.warn("Encountered build error", e);
//    process.exit();
//  });

// Compile the LSP to a separate file
//esbuild
//  .build({
//    entryPoints: ["./src/lsp-server/main.ts"],
//    bundle: true,
//    format: "cjs",
//    platform: "node",
//    sourcemap: true,
//    external: ["vscode", "vscode*", "glob", "file", "prettier"],
//    outfile: "./out/lsp-server.js",
//    watch: WATCH && {
//      onRebuild(error, result) {
//        if (error) {
//          console.warn("Encountered build error", e);
//        }
//        lspServerCompiled(result);
//      },
//    },
//  })
//  .then((result) => {
//    lspServerCompiled(result);
//  })
//  .catch((e) => {
//    console.warn("Encountered build error", e);
//    process.exit();
//  });

if (watch) {
  console.log("Watching  ...");
}
