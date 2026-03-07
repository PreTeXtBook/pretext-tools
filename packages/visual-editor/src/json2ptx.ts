const tt2ptx = {
  para: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  italic: "em",
};

function encode(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function json2ptx(json: any) {
  let ptx = "";
  // NB we are omitting the XML declaration at the top for now.
  // let ptx = '<?xml version="1.0" encoding="UTF-8"?>\n\n';
  // Top level node is a ptxFragment, but double check this:
  if (json.type !== "ptxFragment") {
    console.log("Top level node is not a ptxFragment");
    return "";
  }
  // Now take the content of the ptxFragment and process it:
  if (!json.content) {
    console.log("No content in json");
    return "";
  }
  // There should only be one child in json.content
  if (json.content.length !== 1) {
    console.log("More than one child in json.content");
    return "";
  }
  ptx += processNode(json.content[0]);
  // remove the remaining <ptxdoc> root tags; these are not part of pretext, just used for the visual editor.
  ptx = ptx.replace(/^<ptxdoc>\s*/, '\n').replace(/\s*<\/ptxdoc>/, '');
  return ptx;
}

function processNode(json: any) {
  let ptx = "";
  if (json.content) {
    // every node should have a type; if it needs to be changed, we do so:
    const elementName =
      json.type in tt2ptx
        ? tt2ptx[json.type as keyof typeof tt2ptx]
        : json.type;
    // nodes might have attrs
    const elementAttrs = json.attrs;
    if (elementName === "rawptx") {
      // rawptx nodes are special, they are the unknown tags that we strip away
      for (const fragment of json.content) {
        // fragment should have type text, and we just return its value unchanged
        if (fragment.type !== "text") {
          console.log(
            "Unexpected non-text node inside rawptx: " + JSON.stringify(fragment)
          );
        }
        ptx = ptx + fragment.text;
      }
    } else {
      // all other nodes are processed by adding the correct tag and attributes around its content
      ptx = ptx + "<" + elementName;
      if (elementAttrs) {
        for (const [key, value] of Object.entries(elementAttrs)) {
          if (value !== null) {
            ptx = ptx + " " + key + '="' + value + '"';
          }
        }
      }
      ptx = ptx + ">\n";
      // console.log("content is:"+ json.content)
      for (const fragment of json.content) {
        ptx = ptx + processNode(fragment);
        // console.log(fragment)
        //   // ptx = ptx + "<"+fragment.type+">"
        //   ptx = ptx + json2ptx(fragment.content)
        //   // ptx = ptx + "</"+fragment.type+">\n"
      }
      ptx = ptx + "\n</" + elementName + ">\n";
    }
  } else {
    // text type nodes are exactly the leaf nodes
    if (json.type === "text") {
      if (json.marks) {
        // assume there is only one mark per text node
        const markName =
          json.marks[0].type in tt2ptx
            ? tt2ptx[json.marks[0].type as keyof typeof tt2ptx]
            : json.marks[0].type;
        ptx = ptx + "<" + markName + ">" + encode(json.text) + "</" + markName + ">";
      } else {
        ptx = ptx + encode(json.text);
      }
    } else if (json.type === "hardBreak") {
      ptx = ptx + "\n";
    } else {
      // console.log("Unexpected leaf node type:")
      ptx = ptx + "<!-- Something is missing; got " + JSON.stringify(json) + " -->";
    }
  }
  return ptx;
}

export { json2ptx };
