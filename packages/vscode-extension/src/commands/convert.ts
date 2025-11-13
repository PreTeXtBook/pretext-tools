import { Range, window } from "vscode";
import { markdownToPretext } from "md2ptx";
import { pretextOutputChannel } from "../ui";
import { convertToPretext } from "../importFiles";
import { processLatexViaUnified } from "@unified-latex/unified-latex";
import { htmlLike } from "@unified-latex/unified-latex-util-html-like";
import {
  unifiedLatexToPretext,
  xmlCompilePlugin,
} from "@unified-latex/unified-latex-to-pretext";
// @ts-ignore
import { FlexTeXtConvert } from "frankenmarkup";
import { Environment, Macro } from "@unified-latex/unified-latex-types";
import { lspFormatText } from "../lsp-client/main";
import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import { SKIP, visit } from "unist-util-visit";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsxFromMarkdown } from 'mdast-util-mdx-jsx'
import { mdxJsx } from 'micromark-extension-mdx-jsx'
import * as acorn from 'acorn';


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
    "Converting selected text to PreTeXt format."
  );
  window
    .showQuickPick(["LaTeX", "Markdown", "Mixed text"], {
      placeHolder: "Which format is the selected text?",
    })
    .then(async (qpSelection) => {
      if (!qpSelection) {
        return;
      }
      switch (qpSelection) {
        case "LaTeX":
          convertedText = await cmdLatexToPretext(initialText, selectionRange);
          break;
        case "Markdown":
          convertedText = await markdownToPretext(initialText);
          break;
        case "Mixed text":
          convertedText = await cmdConvertMixedtextToPretext(initialText);
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
  //var newText = latexToPretext(initialText);
  let newText = convertWithUnified(initialText);

  // Remove the starting <p> tag if we selected text in the middle of a line.
  const pTagMatch = newText.match(/^<p>/);
  if (pTagMatch && selectionRange.start.character > 0) {
    newText = newText.replace(/^<p>/, "");
  }

  // Split consecutive tags with a space if present before formatting.
  return lspFormatText(newText.replace(/(>)(<)/g, "$1 $2"));
}

//const myMacroReplacements = {
//  myfoo: (node: Macro) => {
//    console.log("myfoo node is", node.args);
//    const args = getArgsContent(node);
//    console.log("args are", args);
//    return htmlLike({
//      tag: "myptxfoo",
//    });
//  }
//}

const ptxExtraEnvironmentReplacements = {
  solution: (node: Environment) => {
    return htmlLike({
      tag: "solution",
      content: node.content,
    });
  },
  answer: (node: Environment) => {
    return htmlLike({
      tag: "answer",
      content: node.content,
    });
  },
  hint: (node: Environment) => {
    return htmlLike({
      tag: "hint",
      content: node.content,
    });
  },
};

function convertWithUnified(text: string) {
  const convert = (value: string) =>
    processLatexViaUnified()
      .use(unifiedLatexToPretext, {
        producePretextFragment: true,
        //macroReplacements: myMacroReplacements,
        environmentReplacements: ptxExtraEnvironmentReplacements,
      })
      .use(xmlCompilePlugin)
      .processSync({ value });

  pretextOutputChannel.append("Converting selected text to PreTeXt.\n");
  if (convert(text).messages) {
    for (let message of convert(text).messages) {
      pretextOutputChannel.appendLine(message.message);
      console.log(message);
    }
  }
  return convert(text).value as string;
}

async function cmdConvertMixedtextToPretext(initialText: string) {
  pretextOutputChannel.appendLine(
    "Mixed text to PreTeXt conversion is still very experiemental.  Use with care."
  );
  const newText = FlexTeXtConvert(initialText);
  return lspFormatText(newText);
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
    "Experimental conversion functions are designed for testing and may not work as expected."
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

// Modified from the code for micromark-extension-mdx-md, which also disables other things that I don't want to disable.
function noIndentComments() {
  return {
    disable: {null: ['codeIndented']}
  }
}

async function convertPmdWithMdast(initialText: string) {
  // Remove leading and trailing whitespace
  const trimmedText = initialText.trim();
  console.log("initialText is", trimmedText);

  // Convert all comments to jsx style comments:
  const jsxComments = trimmedText.replace(/<!--([\s\S]*?)-->/g, (match, content) => `<![CDATA[${content}]]>\n`);
  console.log("jsxComments is", jsxComments);
  // Converte to mdast:
  // mdxJxs() is still required so that the xml tags are not lost.
  const tree = fromMarkdown(jsxComments, {
    extensions: [noIndentComments(), mdxJsx({acorn, addResult: true})],
    mdastExtensions: [mdxJsxFromMarkdown()]
  });

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
      console.log("text node is", node.value);
      const convertedText = markdownToPretext(node.value);

      console.log("converted text is", convertedText);

      // Replace the text node with the new nodes
      node.value = convertedText;
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
