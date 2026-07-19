const tt2ptx = {
  para: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  italic: "em",
};

/**
 * Node types that are INLINE in the editor schema (they live inside a
 * paragraph's text flow). Their tags must be serialized WITHOUT the
 * newlines we inject around block-level tags — otherwise
 * `<p>Let <m>x</m> be</p>` comes back as `<p>Let <m>\nx\n</m> be</p>`,
 * which the formatter preserves and the round-trip guard then (correctly)
 * flags as a change to the document.
 *
 * This default set mirrors the extensions that declare `inline: true`
 * (Math.ts: m/me/md, Url.ts: url). Internal callers should not rely on the
 * default: roundtrip.ts derives the set from the live editor schema via
 * getSchema() and passes it in, so it can never drift from the extensions.
 * The default exists for external/direct callers of json2ptx.
 */
const DEFAULT_INLINE_TAGS: ReadonlySet<string> = new Set([
  "m",
  "me",
  "md",
  "url",
]);

function encode(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface JsonNode {
  type: string;
  content?: JsonNode[];
  attrs?: Record<string, string | null>;
  text?: string;
  marks?: Array<{ type: string }>;
}

/**
 * Serialize a TipTap/ProseMirror document (as JSON) back to PreTeXt XML.
 *
 * @param json       The editor document; its top node must be `ptxFragment`
 *                   (see editorExtensions.ts).
 * @param inlineTags Node type names to serialize inline (no injected
 *                   newlines). Defaults to DEFAULT_INLINE_TAGS; roundtrip.ts
 *                   passes the set derived from the actual editor schema.
 */
function json2ptx(
  json: JsonNode,
  inlineTags: ReadonlySet<string> = DEFAULT_INLINE_TAGS,
) {
  let ptx = "";
  // NB we are omitting the XML declaration at the top for now.
  // (roundtrip.ts#serializeEditorJson restores the declaration captured at
  // parse time; json2ptx itself never sees it.)
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
  ptx += processNode(json.content[0], inlineTags);
  // remove the remaining <ptxdoc> root tags; these are not part of pretext, just used for the visual editor.
  ptx = ptx.replace(/^<ptxdoc>\s*/, "\n").replace(/\s*<\/ptxdoc>/, "");
  return ptx;
}

function processNode(json: JsonNode, inlineTags: ReadonlySet<string>) {
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
            "Unexpected non-text node inside rawptx: " +
              JSON.stringify(fragment),
          );
        }
        ptx = ptx + fragment.text;
      }
    } else {
      // Inline nodes (m, me, md, url, ...) sit inside a paragraph's text
      // flow, so their tags must hug their content — injecting newlines
      // would alter the document's rendered whitespace and break the
      // round-trip guarantee. Block tags get newlines; the formatter
      // normalizes those afterwards.
      const isInline = inlineTags.has(json.type);
      // all other nodes are processed by adding the correct tag and attributes around its content
      ptx = ptx + "<" + elementName;
      if (elementAttrs) {
        for (const [key, value] of Object.entries(elementAttrs)) {
          if (value !== null) {
            ptx = ptx + " " + key + '="' + value + '"';
          }
        }
      }
      ptx = ptx + (isInline ? ">" : ">\n");
      for (const fragment of json.content) {
        ptx = ptx + processNode(fragment, inlineTags);
      }
      ptx = ptx + (isInline ? "</" : "\n</") + elementName + ">";
      if (!isInline) {
        ptx = ptx + "\n";
      }
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
        ptx =
          ptx +
          "<" +
          markName +
          ">" +
          encode(json.text || "") +
          "</" +
          markName +
          ">";
      } else {
        ptx = ptx + encode(json.text || "");
      }
    } else if (json.type === "hardBreak") {
      ptx = ptx + "\n";
    } else {
      // console.log("Unexpected leaf node type:")
      ptx =
        ptx + "<!-- Something is missing; got " + JSON.stringify(json) + " -->";
    }
  }
  return ptx;
}

export { json2ptx };
