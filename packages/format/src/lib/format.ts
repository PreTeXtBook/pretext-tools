import {
  blockTags,
  lineEndTags,
  newlineTags,
  verbatimTags,
} from "./docStructure";

// Function to join lines of text, preserving verbatim blocks.
function joinLines(fullText: string): string {
  let verbatim = false;
  let lines = fullText.split(/\r\n|\r|\n/g);
  // Start by adding the first two lines of the document.
  let joinedLines = [lines[0].trim()];
  if (lines.length > 1) {
    joinedLines.push(lines[1].trim());
  }
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
      // Clean up the (non-verbatim) line by adding a space between consecutive tags, and trim it.
      lines[i] = lines[i].trim();
      let lastLine = joinedLines.pop();
      if (lastLine) {
        joinedLines.push(lastLine.trim() + " " + lines[i]);
      } else {
        joinedLines.push(lines[i]);
      }
    }
  }
  let joinedText = joinedLines.join("\n");
  return joinedText;
}

export function formatPretext(
  text: string,
  options?: {
    breakLines?: "few" | "some" | "many";
    breakSentences?: boolean;
    insertSpaces?: boolean;
    tabSize?: number;
  },
): string {
  // set default options
  const breakSentences = options?.breakSentences ?? false;
  const tabSize = options?.tabSize ?? 2;
  const insertSpaces = options?.insertSpaces ?? true;
  const blankLines = options?.breakLines ?? "some";

  // First clean up document so that each line is a single tag when appropriate.
  let allText = joinLines(text);

  console.log("Getting ready to start formatting.");
  for (let btag of blockTags) {
    if (allText.includes("<" + btag)) {
      // start tag can be <tag>, <tag attr="val">, or <tag xmlns="..."> but shouldn't be self closing (no self closing tag would have xmlns in it)
      let startTag = new RegExp(
        "<" + btag + "(>|(\\s[^\\/]*?)>|(.*xmlns.*?)>)",
        "g",
      );
      let endTag = new RegExp("<\\/" + btag + ">([\\s\\S]*?[.,!?;:]?)", "g");
      allText = allText.replace(startTag, "\n$&\n");
      allText = allText.replace(endTag, "\n$&\n");
    }
  }

  for (let tag of lineEndTags) {
    let startTag = new RegExp("<" + tag + "(.*?)>", "g");
    let endTag = new RegExp("<\\/" + tag + ">([\\s\\S]*?[.,!?;:]?)", "g");
    let selfCloseTag = new RegExp("<" + tag + "(.*?)\\/>", "g");
    allText = allText.replace(startTag, "\n$&");
    allText = allText.replace(endTag, "$&\n");
    allText = allText.replace(selfCloseTag, "$&\n");
  }

  // Set indent character to \t or a number of ss based on editor settings.
  let indentChar = "\t";
  if (insertSpaces && typeof tabSize === "number") {
    indentChar = " ".repeat(tabSize);
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
      fixedLines.push(trimmedLine + "\n");
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
        trimmedLine = trimmedLine.replace(
          /\.\s+/g,
          ".\n" + indentChar.repeat(level),
        );
      }
      fixedLines.push(indentChar.repeat(level) + trimmedLine);
    }
  }
  // Second pass: add empty line between appropriate tags depending on blankLines setting.
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
        if (
          fixedLines[i].trim().startsWith("</") ||
          (fixedLines[i].trim().startsWith("<") &&
            fixedLines[i + 1].trim().startsWith("<"))
        ) {
          fixedLines[i] += "\n";
        }
      }
      break;
  }

  //// Add document identifier line if missing:
  //if (!fixedLines[0].trim().startsWith("<?xml")) {
  //  fixedLines.unshift('<?xml version="1.0" encoding="UTF-8" ?>\n');
  //}

  allText = fixedLines.join("\n");

  return allText;
}
