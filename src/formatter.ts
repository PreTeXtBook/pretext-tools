import * as vscode from "vscode";

const docStructure = [
  "abstract",
  "acknowledgement",
  "appendix",
  "article",
  "author",
  "backmatter",
  "biography",
  "book",
  "chapter",
  "colophon",
  "contributor",
  "contributors",
  "copyright",
  "credit",
  "dedication",
  "docinfo",
  "editor",
  "feedback",
  "frontmatter",
  "google",
  "html",
  "index",
  "macros",
  "mathbook",
  "preface",
  "pretext",
  "references",
  "search",
  "shortlicense",
  "solutions",
  "subsection",
  "titlepage",
  "website",
];

const docSecs = [
  "assemblage",
  "chapter",
  "conclusion",
  "introduction",
  "objectives",
  "outcomes",
  "paragraphs",
  "part",
  "postlude",
  "prelude",
  "reading-questions",
  "sbsgroup",
  "section",
  "stack",
  "subsection",
  "subsubsection",
  "task",
  "technology",
  "worksheet",
];

const docEnvs = [
  "activity",
  "algorithm",
  "answer",
  "axiom",
  "biblio",
  "blockquote",
  "case",
  "choice",
  "choices",
  "claim",
  "conjecture",
  "console",
  "corollary",
  "definition",
  "demonstration",
  "description",
  "example",
  "exercise",
  "exploration",
  "fact",
  "hint",
  "image",
  "images",
  "insight",
  "investigation",
  "lemma",
  "list",
  "listing",
  "note",
  "openconjecture",
  "openproblem",
  "openquestion",
  "page",
  "poem",
  "principle",
  "problem",
  "program",
  "project",
  "proof",
  "proposition",
  "question",
  "remark",
  "shortdescription",
  "solution",
  "stanza",
  "statement",
  "subtask",
  "table",
  "tabular",
  "theorem",
  "warning",
  "webwork",
];

const lineEndTags = [
  "address",
  "attribution",
  "caption",
  "cd",
  "cell",
  "cline",
  "date",
  "department",
  "description",
  "edition",
  "entity",
  "holder",
  "idx",
  "institution",
  "journal",
  "line",
  "location",
  "minilicense",
  "mrow",
  "personname",
  "pg-macros",
  "pubtitle",
  "row",
  "subtitle",
  "title",
  "usage",
  "volume",
  "year",
  "xi:include",
];

// empty tags that should be on their own line
const docEmpty = [
  "cell",
  "col",
  "notation-list",
  "brandlogo",
  "cross-references",
  "input",
  "video",
  "slate",
  "webwork",
];

const list_like = ["ol", "ul", "dl"];

const math_display = ["me", "men", "md", "mdn"];

const footnote_like = ["fn"];

const nestable_tags = ["ul", "ol", "li", "p", "task", "figure", "sidebyside", "notation", "row"];

// note that c is special, because it is inline verbatim
const verbatimTags = [
  "latex-image-preamble",
  "latex-image",
  "latex-preamble",
  "slate",
  "sage",
  "sageplot",
  "asymptote",
  "macros",
  "program",
  "input",
  "output",
  "prompt",
  "pre",
  "pg-code",
  "tikzpicture",
  "tikz",
  "code",
  "c",
];

const newlineTags = [
  ...docStructure,
  ...docSecs,
  ...docEnvs,
  ...nestable_tags,
  "xi:include",
];

const blockTags = [
  ...docStructure,
  ...docSecs,
  ...docEnvs,
  ...nestable_tags,
  ...math_display,
];

function joinLines(fullText: string): string {
  let verbatim = false;
  let lines = fullText.split(/\r\n|\r|\n/g);
  // Start by adding the first two lines of the document.
  let joinedLines = [lines[0], lines[1]];
  // Itterate through lines, joining lines when not in a verbatim block.
  for (let i = 2; i < lines.length; i++) {
    // look for tags in a line
    let openTagMatch = /^<(\w\S*?)(\s.*?|>)$/.exec(lines[i].trim());
    let closeTagMatch = /^<\/(\w\S*?)(\s.*?|>)(.?)$/.exec(lines[i].trim());
    if (openTagMatch && verbatimTags.includes(openTagMatch[1])) {
      // This line starts a verbatim block.  Add it to the array of lines and set verbatim to true.
      joinedLines.push(lines[i]);
      verbatim = true;
    } else if (closeTagMatch && verbatimTags.includes(closeTagMatch[1])) {
      // This line ends a verbatim block.  Add it to the array of lines and set verbatim to false.
      joinedLines.push(lines[i]);
      verbatim = false;
    } else if (verbatim) {
      // We must be inside a verbatim block.  Add the line to the array of lines.
      joinedLines.push(lines[i]);
    } else {
      // We are not inside a verbatim block.  Concatenate the line to the previous line in joinedLines
      let lastLine = joinedLines.pop();
      if (lastLine) {
        joinedLines.push(lastLine.trim() + " " + lines[i].trim());
      } else {
        joinedLines.push(lines[i].trim());
      }
    }
  }
  let joinedText = joinedLines.join("\n");
  return joinedText;
}

export function formatPTX(document: vscode.TextDocument): vscode.TextEdit[] {
  // First clean up document so that each line is a single tag when appropriate.
  let allText = document.getText();

  allText = joinLines(allText);

  console.log("Getting ready to start formatting.");
  for (let btag of blockTags) {
    if (allText.includes("<" + btag)) {
      // start tag can be <tag>, <tag attr="val">, or <tag xmlns="..."> but shouldn't be self closing (no self closing tag would have xmlns in it)
      let startTag = new RegExp("<" + btag + "(>|([^/]*?)>|(.*xmlns.*?)>)", "g");
      let endTag = new RegExp("<\\/" + btag + ">(.?)", "g");
      allText = allText.replace(startTag, "\n$&\n");
      allText = allText.replace(endTag, "\n$&\n");
    }
  }
  for (let tag of lineEndTags) {
    let startTag = new RegExp("<" + tag + "(.*?)>", "g");
    let endTag = new RegExp("<\\/" + tag + ">(.?)", "g");
    let selfCloseTag = new RegExp("<" + tag + "(.*?)/>", "g");
    allText = allText.replace(startTag, "\n$&");  
    allText = allText.replace(endTag, "$&\n");
    allText = allText.replace(selfCloseTag, "$&\n");
  }

  const breakSentences = vscode.workspace
    .getConfiguration("pretext-tools")
    .get("formatter.breakSentences");
  console.log("extraLineBreaks is", breakSentences);

  // Determine the number of spaces or tabs each indent is in current editor.
  let editorTabSize = vscode.window.activeTextEditor?.options.tabSize;
  console.log("editorTabSize is", editorTabSize);
  let editorInsertSpaces = vscode.window.activeTextEditor?.options.insertSpaces;
  console.log("editorInsertSpaces is", editorInsertSpaces);
  // Set indent character to \t or a number of ss based on editor settings.
  let indentChar = "\t";
  if (editorInsertSpaces && typeof editorTabSize === "number") {
    indentChar = " ".repeat(editorTabSize);
  }

  let level = 0;
  let verbatim = false;
  let lines = allText.split(/\r\n|\r|\n/g);
  let fixedLines = [];
  for (let line of lines) {
    let trimmedLine = line.trim();
    let openTagMatch = /^<(\w\S*?)(\s.*?|>)$/.exec(trimmedLine);
    let closeTagMatch = /^<\/(\w\S*?)(\s.*?|>)(.?)$/.exec(trimmedLine);
    // let selfCloseTagMatch = /^<(\w*?)(\s.*?\/>|\/>)$/.exec(trimmedLine);
    if (trimmedLine.length === 0) {
      continue;
    } else if (trimmedLine.startsWith("<?")) {
      // It's the start line of the file:
      fixedLines.push(trimmedLine+"\n");
    } else if (trimmedLine.startsWith("<!--")) {
      // It's a comment:
      fixedLines.push(indentChar.repeat(level) + trimmedLine);
    } else if (closeTagMatch) {
      if (blockTags.includes(closeTagMatch[1])) {
        level = Math.max(0, level - 1);
        fixedLines.push(indentChar.repeat(level) + trimmedLine);
      } else if (verbatimTags.includes(closeTagMatch[1])) {
        verbatim = false;
        fixedLines.push(indentChar.repeat(level) + trimmedLine);
      } else {
        fixedLines.push(indentChar.repeat(level) + trimmedLine);
      }
    } else if (openTagMatch) {
      fixedLines.push(indentChar.repeat(level) + trimmedLine);
      if (blockTags.includes(openTagMatch[1])) {
        level += 1;
      } else if (verbatimTags.includes(openTagMatch[1])) {
        verbatim = true;
      }
    } else if (verbatim) {
      fixedLines.push(line);
    } else {
      if (breakSentences) {
        trimmedLine = trimmedLine.replace(/\.\s+/g, ".\n" + indentChar.repeat(level));
      }
      fixedLines.push(indentChar.repeat(level) + trimmedLine);
    }
  }
  // Second pass: add empty line between appropriate tags depending on blankLines setting.
  const blankLines = vscode.workspace.getConfiguration("pretext-tools").get("formatter.blankLines");
  switch (blankLines) {
    case "few":
      // do nothing
      break;
    case "some":
      for (let i = 0; i < fixedLines.length - 1; i++) {
        if (fixedLines[i].trim().startsWith("</")) {
          for (let tag of newlineTags) {
            let startTag = new RegExp("<" + tag + "(.*?)>", "g");
            if (startTag.test(fixedLines[i + 1])) {
              fixedLines[i] += "\n";
            }
          }
        } else if (fixedLines[i].trim().startsWith("<title>")) {
          fixedLines[i] += "\n";
        }
      }
      break;
    case "many":
      for (let i = 0; i < fixedLines.length - 1; i++) {
        if (fixedLines[i].trim().startsWith("</") || (fixedLines[i].trim().startsWith("<") && fixedLines[i+1].trim().startsWith("<"))) {
          fixedLines[i] += "\n";
        }
      }
      break;
  }

  // Add document identifier line if missing:
  if (!fixedLines[0].trim().startsWith("<?xml")) {
    fixedLines.unshift('<?xml version="1.0" encoding="UTF-8" ?>\n');
  }

  allText = fixedLines.join("\n");

  return [
    vscode.TextEdit.replace(
      document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)),
      allText + "\n"
    ),
  ];
}
