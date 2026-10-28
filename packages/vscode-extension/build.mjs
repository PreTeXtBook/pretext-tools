// Build all parts of the plugin
import esbuild from "esbuild";
import path from "node:path";

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
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

const extensionCompiled = statusUpdateFunction(
  "./src/extension.ts",
  "./out/extension.js",
);
const lspServerCompiled = statusUpdateFunction(
  "./src/lsp-server/main.ts",
  "./out/lsp-server.js",
);

const buildOptions = {
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  external: ["vscode"],
  outfile: "../../dist/vscode-extension/out/extension.js",
  plugins: [esbuildProblemMatcherPlugin],
};

// Browser entry point (package.json "browser"): the same extension loaded by
// github.dev / vscode.dev, where extensions run in a Web Worker. No Node
// built-ins may reach this bundle; `src/extension.web.ts` imports only the
// modules that stay clear of them. CommonJS output is what the web extension
// host expects. The `worker` export condition matters: packages such as
// decode-named-character-reference resolve their `browser` entry to a DOM
// implementation (`document.createElement` at module scope), which throws in
// a worker; `worker` selects their DOM-free entry. `path` becomes the posix
// path-browserify: the manifest resolver, project outline and xi:include
// arithmetic use it, and on this host only ever on the virtual absolute
// paths of src/virtual-path.ts.
const webResolve = {
  platform: "browser",
  conditions: ["worker"],
  external: ["vscode"],
  alias: { path: "path-browserify" },
};

const buildOptionsWeb = {
  entryPoints: ["./src/extension.web.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  ...webResolve,
  outfile: "../../dist/vscode-extension/out/extension.web.js",
  plugins: [esbuildProblemMatcherPlugin],
};

// Browser smoke tests, run in the same Web Worker host by `@vscode/test-web`
// (`npm run test:web`). Not shipped: out/test-web is in .vscodeignore.
const buildOptionsWebTests = {
  entryPoints: ["./src/test/web/index.ts"],
  bundle: true,
  format: "cjs",
  sourcemap: !production,
  sourcesContent: false,
  ...webResolve,
  outfile: "../../dist/vscode-extension/out/test-web/index.js",
  plugins: [esbuildProblemMatcherPlugin],
};

// The language server for the web host: same source, bundled to run in a Web
// Worker (an IIFE; workers take a classic script). Beyond the shared
// `webResolve` substitutions, the platform seam (src/lsp-server/platform.ts →
// platform.browser.ts) makes it Node-free.
const lspPlatformBrowserPlugin = {
  name: "lsp-platform-browser",
  setup(build) {
    build.onResolve({ filter: /^\.\.?\/platform$/ }, (args) => ({
      path: path.resolve(args.resolveDir, `${args.path}.browser.ts`),
    }));
  },
};

const buildOptionsLSPWeb = {
  entryPoints: ["./src/lsp-server/main.ts"],
  bundle: true,
  format: "iife",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  ...webResolve,
  outfile: "../../dist/vscode-extension/out/lsp-server.web.js",
  plugins: [lspPlatformBrowserPlugin, esbuildProblemMatcherPlugin],
};

const buildOptionsLSP = {
  entryPoints: ["./src/lsp-server/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  external: ["vscode"],
  outfile: "../../dist/vscode-extension/out/lsp-server.js",
  plugins: [esbuildProblemMatcherPlugin],
};

// The instant-preview worker is a separate forked process on the desktop
// (WebAssembly JSPI may need a process-level flag). ESM output because the
// bundled libxslt-wasm glue uses top-level await; the .wasm binary itself is
// copied next to the bundle by copy-vscode-extension-assets.mjs and located
// at runtime via `new URL("libxslt.wasm", import.meta.url)`.
const buildOptionsPreviewWorker = {
  entryPoints: ["./src/instant-preview-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  external: ["vscode"],
  outfile: "../../dist/vscode-extension/out/instant-preview-worker.mjs",
  plugins: [esbuildProblemMatcherPlugin],
};

const ctx = await esbuild.context({ ...buildOptions });

if (watch) {
  await ctx.watch();
  console.log("Watching  ...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

const ctxWeb = await esbuild.context({ ...buildOptionsWeb });

if (watch) {
  await ctxWeb.watch();
} else {
  await ctxWeb.rebuild();
  await ctxWeb.dispose();
}

const ctxWebTests = await esbuild.context({ ...buildOptionsWebTests });

if (watch) {
  await ctxWebTests.watch();
} else {
  await ctxWebTests.rebuild();
  await ctxWebTests.dispose();
}

const ctxLSPWeb = await esbuild.context({ ...buildOptionsLSPWeb });

if (watch) {
  await ctxLSPWeb.watch();
} else {
  await ctxLSPWeb.rebuild();
  await ctxLSPWeb.dispose();
}

const ctxLSP = await esbuild.context({ ...buildOptionsLSP });

if (watch) {
  await ctxLSP.watch();
} else {
  await ctxLSP.rebuild();
  await ctxLSP.dispose();
}

// The same renderer for the web host, as a Web Worker. A *classic* worker
// script, like the language server's: VS Code bootstraps a web extension's
// nested workers through `importScripts`, which cannot load a module. But
// the renderer's top-level await rules out esbuild's IIFE format, so this is
// ESM output with no imports or exports left in it (everything is bundled),
// wrapped in an async IIFE by banner/footer. `import.meta.url` — a syntax
// error in a classic script — is defined away to a fake origin, which makes
// the Emscripten glue fetch its .wasm from there; the worker answers that
// fetch with bytes the extension host sends it (preview-worker-bootstrap.ts).
// `@pretextbook/pretext-html` resolves to its browser build (the package's
// `browser` export condition), which reads files through the host.
//
// The Emscripten glue also carries Node-only branches that `import()` the
// "module" and "worker_threads" built-ins; they are dead in a browser worker
// but esbuild still has to resolve them, so they resolve to empty stubs.
const nodeBuiltinStubPlugin = {
  name: "node-builtin-stub",
  setup(build) {
    build.onResolve({ filter: /^(module|worker_threads)$/ }, (args) => ({
      path: args.path,
      namespace: "node-builtin-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "node-builtin-stub" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

const buildOptionsPreviewWorkerWeb = {
  entryPoints: ["./src/instant-preview-worker.web.ts"],
  bundle: true,
  format: "esm",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  ...webResolve,
  define: {
    "import.meta.url": JSON.stringify("http://wasm.ptx.invalid/worker.js"),
  },
  banner: { js: "(async () => {" },
  footer: { js: "})();" },
  outfile: "../../dist/vscode-extension/out/instant-preview-worker.web.js",
  plugins: [nodeBuiltinStubPlugin, esbuildProblemMatcherPlugin],
};

const ctxPreviewWorkerWeb = await esbuild.context({
  ...buildOptionsPreviewWorkerWeb,
});

if (watch) {
  await ctxPreviewWorkerWeb.watch();
} else {
  await ctxPreviewWorkerWeb.rebuild();
  await ctxPreviewWorkerWeb.dispose();
}

const ctxPreviewWorker = await esbuild.context({
  ...buildOptionsPreviewWorker,
});

if (watch) {
  await ctxPreviewWorker.watch();
} else {
  await ctxPreviewWorker.rebuild();
  await ctxPreviewWorker.dispose();
}

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
