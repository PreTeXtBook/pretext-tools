import { Range, window, workspace } from "vscode";
import { markdownToPretext } from "md2ptx";
import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { pretextOutputChannel } from "../ui";
import { convertToPretext } from "../importFiles";
// @ts-expect-error frankenmarkup does not publish types.
import { FlexTeXtConvert } from "frankenmarkup";
import { lspFormatText } from "../lsp-client/main";
import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import { SKIP, visit } from "unist-util-visit";
import { fromMarkdown } from "mdast-util-from-markdown";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { remarkPretext } from "@pretextbook/remark-pretext";
import { collectPtxSchemaViolations } from "@pretextbook/ptxast";
import type { PtxRoot } from "@pretextbook/ptxast";

export function cmdConvertFile() {
  pretextOutputChannel.append("Converting selected file to PreTeXt");
  // show quick pick to select whether to convert with pandoc or plastex
  window
    .showQuickPick(["plastex", "pandoc"], {
      placeHolder: "Select a converter",
    })
    .then((qpSelection) => {
      if (qpSelection === "pandoc") {
        convertToPretext("pandoc");
      } else if (qpSelection === "plastex") {
        convertToPretext("plastex");
      }
    });
}

export async function cmdConvertText() {
  const editor = window.activeTextEditor;
  if (!editor) {
    pretextOutputChannel.appendLine("No active editor found to convert text.");
    return;
  }
  const selection = editor.selection;
  const selectionRange = selection.isEmpty
    ? editor.document.lineAt(selection.start.line).range
    : new Range(selection.start, selection.end);

  const initialText = editor.document.getText(selectionRange);
  let convertedText: string;

  pretextOutputChannel.appendLine(
    "Converting selected text to PreTeXt format.",
  );
  const experimentalFeaturesEnabled = workspace
    .getConfiguration("pretext-tools")
    .get<boolean>("experimentalFeatures", false);
  const conversionOptions = [
    "LaTeX-style PreTeXt",
    "PreTeXt Markdown",
    "Classic Markdown",
    ...(experimentalFeaturesEnabled
      ? ["PreTeXt Markdown (Experimental ptxast)"]
      : []),
  ];
  window
    .showQuickPick(conversionOptions, {
      placeHolder: "Which format is the selected text?",
    })
    .then(async (qpSelection) => {
      if (!qpSelection) {
        return;
      }
      switch (qpSelection) {
        case "LaTeX-style PreTeXt":
          convertedText = await cmdLatexToPretext(initialText, selectionRange);
          break;
        case "Classic Markdown":
          convertedText = await validateAndFormatConvertedPretext(
            "Classic Markdown",
            await markdownToPretext(initialText),
          );
          break;
        case "PreTeXt Markdown":
          convertedText = await cmdConvertPMDToPretext(initialText);
          break;
        case "PreTeXt Markdown (Experimental ptxast)":
          convertedText = await cmdConvertPMDToPretextExperimental(initialText);
          break;
      }
    })
    .then(() => {
      if (convertedText) {
        editor.edit((editBuilder) => {
          editBuilder.replace(selectionRange, convertedText);
        });
      }
    });
}

async function cmdLatexToPretext(initialText: string, selectionRange: Range) {
  let newText = convertWithUnified(initialText);

  // Remove the starting <p> tag if we selected text in the middle of a line.
  const pTagMatch = newText.match(/^<p>/);
  if (pTagMatch && selectionRange.start.character > 0) {
    newText = newText.replace(/^<p>/, "");
  }

  // Validate the final XML that will be formatted/inserted.
  appendConversionValidation("LaTeX-style PreTeXt", newText);

  // Split consecutive tags with a space if present before formatting.
  return formatConvertedPretext(newText);
}

function convertWithUnified(text: string) {
  const converted = latexToPretext(text);

  pretextOutputChannel.append("Converting selected text to PreTeXt.\n");
  if (converted.messages) {
    for (const message of converted.messages) {
      pretextOutputChannel.appendLine(message.message);
      console.log(message);
    }
  }
  return converted.value as string;
}

async function cmdConvertPMDToPretext(initialText: string) {
  const newText = FlexTeXtConvert(initialText);
  return validateAndFormatConvertedPretext("PreTeXt Markdown", newText);
}

async function cmdConvertPMDToPretextExperimental(initialText: string) {
  pretextOutputChannel.appendLine(
    "PreTeXt Markdown ptxast conversion is experimental. Use with care.",
  );
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);
  const mdast = processor.parse(initialText);
  const ptxast = processor.runSync(mdast, { value: initialText }) as PtxRoot;
  const newText = toXml(ptxast.children);
  return validateAndFormatConvertedPretext(
    "PreTeXt Markdown (Experimental ptxast)",
    newText,
  );
}

function formatConvertedPretext(xml: string) {
  return lspFormatText(xml.replace(/(>)(<)/g, "$1 $2"));
}

async function validateAndFormatConvertedPretext(
  sourceLabel: string,
  xml: string,
) {
  appendConversionValidation(sourceLabel, xml);
  return formatConvertedPretext(xml);
}

function appendConversionValidation(sourceLabel: string, xml: string) {
  try {
    // Wrap in a <root> element so fragments with multiple top-level elements
    // are parsed safely (xast-util-from-xml requires a single XML root).
    // The resulting PtxRoot has one child — the wrapper <root> element —
    // whose children are the actual fragment nodes.
    const wrapped = fromXml(`<root>${xml}</root>`);
    const wrapperElement = wrapped.children.find((c) => c.type === "element");
    const fragmentRoot: PtxRoot = {
      type: "root",
      children:
        wrapperElement && "children" in wrapperElement
          ? (wrapperElement as PtxRoot).children
          : (wrapped.children as PtxRoot["children"]),
    };
    const violations = collectPtxSchemaViolations(fragmentRoot);
    if (violations.length === 0) {
      pretextOutputChannel.appendLine(
        `${sourceLabel} conversion passed XML-to-ptxast validation.`,
      );
      return;
    }

    pretextOutputChannel.appendLine(
      `${sourceLabel} conversion produced ${violations.length} schema warning(s):`,
    );
    for (const violation of violations.slice(0, 10)) {
      pretextOutputChannel.appendLine(`  - ${violation}`);
    }
    if (violations.length > 10) {
      pretextOutputChannel.appendLine(
        `  - ...and ${violations.length - 10} more warning(s).`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pretextOutputChannel.appendLine(
      `${sourceLabel} conversion could not be parsed back into xast: ${message}`,
    );
  }
}

////////////////// Experiments /////////////////////

export async function cmdExperimentConvert() {
  const editor = window.activeTextEditor;
  if (!editor) {
    pretextOutputChannel.appendLine("No active editor found to convert text.");
    return;
  }
  const selection = editor.selection;
  const selectionRange = selection.isEmpty
    ? editor.document.lineAt(selection.start.line).range
    : new Range(selection.start, selection.end);

  const initialText = editor.document.getText(selectionRange);
  let convertedText: string;

  // Prompt user to select a conversion method
  pretextOutputChannel.appendLine(
    "Experimental conversion functions are designed for testing and may not work as expected.",
  );
  window
    .showQuickPick([
      {
        label: "Use mdast",
        description: "Preprocess selected text with Markdown AST",
        function: "useMdast",
      },
      {
        label: "Use xast",
        description: "Convert selected text to PreTeXt format",
        function: "useXast",
      },
    ])
    .then(async (selection) => {
      if (!selection) {
        return;
      }
      switch (selection.function) {
        case "useMdast":
          convertedText = await convertPmdWithMdast(initialText);
          break;
        case "useXast":
          convertedText = await convertPmdWithXast(initialText);
          break;
      }
    })
    .then(() => {
      if (convertedText) {
        editor.edit((editbuilder) => {
          editbuilder.replace(selectionRange, convertedText);
        });
      }
    });
}

async function convertPmdWithMdast(initialText: string) {
  // Remove leading and trailing whitespace
  const trimmedText = initialText.trim();
  console.log("initialText is", trimmedText);

  // Converte to mdast:
  const tree = fromMarkdown(trimmedText);

  console.log("mdast before: ", tree);

  //const convertedText = toXml(tree);

  // Convert the text using FlexTeXtConvert
  //const convertedText = FlexTeXtConvert(trimmedText);
  const convertedText = initialText;
  console.log("converted text is", convertedText);

  // Format the converted text
  return lspFormatText(convertedText);
}

async function convertPmdWithXast(initialText: string) {
  console.log("initialText is", initialText);

  const tree = fromXml(`<root>${initialText}</root>`);

  console.log("xast before: ", tree);

  visit(tree, (node, index, parent) => {
    if (node.type === "text") {
      const converted = FlexTeXtConvert(node.value);

      console.log("converted text is", converted);

      const subtree = fromXml(converted);
      // replace the node with the subtree
      if (typeof index !== "number" || !parent) {
        return;
      }

      parent.children.splice(index, 1, ...subtree.children);
      return SKIP;
    }
  });

  console.log("xast after: ", tree);
  // Convert the resulting tree back to XML
  let newXml = toXml(tree);

  console.log("back to xml: ", newXml);
  // strip the <root> and </root> tags
  const rootTagMatch = newXml.match(/^<root>\s*([\s\S]*?)\s*<\/root>$/);
  if (rootTagMatch) {
    newXml = rootTagMatch[1];
  }

  return lspFormatText(newXml);
}
