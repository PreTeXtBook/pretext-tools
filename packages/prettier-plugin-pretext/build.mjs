import esbuild from "esbuild";

(async () => {
    const commonConfig = {
        entryPoints: ["./src/plugin.ts"],
        outfile: "./dist/index.mjs",
        bundle: true,
        minify: false,
        sourcemap: true,
        format: "esm",
        target: "node18",
        //plugins: [nodeExternalsPlugin()],
     //   external: [...explicitDeps],
    };

    // Build the ESM
    esbuild.build(commonConfig).catch(() => process.exit(1));

    // Build a CommonJS version as well
    esbuild
        .build({
            ...commonConfig,
            outfile: "./dist/index.cjs",
            format: "cjs",
        })
        .catch(() => process.exit(1));
})();