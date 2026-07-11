import type { Plugin } from "./types";
import parser from "./parser";
import printer from "./printer";

const plugin: Plugin = {
    languages: [
        {
            name: "PTX",
            parsers: ["ptx"],
            extensions: [".xml", ".ptx"],
            vscodeLanguageIds: ["xml", "ptx"],
            linguistLanguageId: 399,
        },
    ],
    parsers: {
        ptx: parser,
    },
    printers: {
        ptx: printer,
    },
    options: {},
    defaultOptions: {
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        singleAttributePerLine: false,
    },
};

export default plugin;
