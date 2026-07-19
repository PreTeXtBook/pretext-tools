/**
 * TipTap node/mark names whose PreTeXt tag differs from the name. Also
 * consumed by editorExtensions.ts when deriving the set of source tags the
 * editor can represent (editorSourceTags), so the mapping lives in exactly
 * one place.
 */
const tt2ptx = {
  para: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  italic: "em",
};

export { tt2ptx };

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

/**
 * Escape a value for use inside a double-quoted XML attribute. Without
 * this, an href like "…?a=1&b=2" (the DOM stores the DECODED value) would
 * be emitted as a bare `&` and produce not-well-formed XML.
 */
function encodeAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/** Map a TipTap node type to its PreTeXt element name (see tt2ptx). */
function resolveName(type: string): string {
  return type in tt2ptx ? tt2ptx[type as keyof typeof tt2ptx] : type;
}

/**
 * Serialize a node's attrs record as ` key="value"` pairs (null = unset).
 *
 * The `ptxAttrs` key holds the node's captured SOURCE attributes as a
 * nested record (see PtxSourceAttributes in editorExtensions.ts); it is
 * expanded in place, preserving the source's attribute order (object key
 * order is insertion order, which parseHTML fills in document order).
 * All values are XML-escaped — attribute values in the editor state are
 * stored decoded, so `&` etc. must be re-escaped on the way out.
 */
function attrString(attrs: JsonNode["attrs"]): string {
  let out = "";
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "ptxAttrs") {
        if (value) {
          for (const [name, attrValue] of Object.entries(
            value as Record<string, string>,
          )) {
            out = out + " " + name + '="' + encodeAttr(attrValue) + '"';
          }
        }
      } else if (value !== null && value !== undefined) {
        out = out + " " + key + '="' + encodeAttr(String(value)) + '"';
      }
    }
  }
  return out;
}

interface JsonNode {
  type: string;
  content?: JsonNode[];
  /**
   * ProseMirror attributes. `ptxAttrs` is special: it is the catch-all
   * record of the node's original SOURCE attributes, captured by the
   * PtxSourceAttributes extension (editorExtensions.ts); attrString expands
   * it back into individual XML attributes. Any other key is an attribute
   * some TipTap extension declared directly (e.g. codeBlock's `language`).
   */
  attrs?: Record<string, unknown>;
  text?: string;
  /**
   * Marks attached to this node. Present on text nodes AND on inline
   * element nodes (a chip or <m> inside an <em> span carries the em mark).
   * ProseMirror stores marks in schema-rank order (see Inline.ts for the
   * rank ordering), which processChildren relies on for its run-merging.
   * Mark attributes are ignored — none of the PreTeXt marks we model
   * (em/term/alert/c) carry attributes.
   */
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

/**
 * Serialize a sequence of sibling nodes, emitting mark tags at RUN
 * boundaries rather than around every node.
 *
 * ProseMirror does not nest marked text — it stores a flat sequence of
 * inline nodes, each carrying its own set of marks. `<em>All <term>x</term>
 * done</em>` parses to three siblings: "All " [em], "x" [em, term],
 * " done" [em]. Serializing each node's marks independently would emit
 * `<em>All </em><em><term>x</term></em><em> done</em>` — semantically the
 * same, but a rewrite of the document that the round-trip guard rightly
 * refuses. Instead we keep a stack of currently-open marks and only
 * close/open tags where adjacent siblings' mark lists diverge — the same
 * strategy ProseMirror's own DOMSerializer uses.
 *
 * This works because ProseMirror stores each node's marks in schema-rank
 * order (the order the marks are registered in Inline.ts: em, term, alert,
 * c), so shared prefixes line up across siblings. The trade-off: original
 * nesting ORDER is not recorded by ProseMirror at all (marks are sets), so
 * only nesting that matches the rank order can be reproduced —
 * `<em><term>…</term></em>` round-trips, `<term><em>…</em></term>` comes
 * back canonicalized. That residual case is documented in
 * roundtrip.gaps.spec.ts.
 *
 * Block-level children never carry marks, so for them this degrades to
 * plain concatenation.
 */
function processChildren(
  children: JsonNode[],
  inlineTags: ReadonlySet<string>,
) {
  let ptx = "";
  // Mark tags currently open, outermost first.
  let active: string[] = [];
  for (const child of children) {
    const marks = (child.marks ?? []).map((mark) => resolveName(mark.type));
    // How many already-open marks this node keeps (shared prefix).
    let keep = 0;
    while (
      keep < active.length &&
      keep < marks.length &&
      active[keep] === marks[keep]
    ) {
      keep++;
    }
    // Close marks this node does not continue, innermost first...
    for (let i = active.length - 1; i >= keep; i--) {
      ptx = ptx + "</" + active[i] + ">";
    }
    // ...then open the marks it adds.
    for (let i = keep; i < marks.length; i++) {
      ptx = ptx + "<" + marks[i] + ">";
    }
    active = marks;
    ptx = ptx + processNode(child, inlineTags);
  }
  // Close whatever is still open at the end of the sequence.
  for (let i = active.length - 1; i >= 0; i--) {
    ptx = ptx + "</" + active[i] + ">";
  }
  return ptx;
}

/**
 * Serialize a single node WITHOUT its marks — mark tags are the parent
 * sequence's responsibility (processChildren), which is what allows a mark
 * to span several siblings without splitting.
 */
function processNode(json: JsonNode, inlineTags: ReadonlySet<string>) {
  let ptx = "";
  if (json.content) {
    // every node should have a type; if it needs to be changed, we do so:
    const elementName = resolveName(json.type);
    if (json.type === "rawptx" || json.type === "rawptxInline") {
      // The rawptx escape hatches (block <rawptx> and inline
      // <rawptx-inline>) hold raw PreTeXt source as plain text; emit it
      // verbatim with no wrapper tags and no injected whitespace, so the
      // original markup returns exactly as it was wrapped by cleanPtx.
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
      ptx = ptx + "<" + elementName + attrString(json.attrs);
      ptx = ptx + (isInline ? ">" : ">\n");
      ptx = ptx + processChildren(json.content, inlineTags);
      ptx = ptx + (isInline ? "</" : "\n</") + elementName + ">";
      if (!isInline) {
        ptx = ptx + "\n";
      }
    }
  } else {
    // Nodes WITHOUT a content key are either true leaves (text, hardBreak)
    // or element nodes that are currently empty — ProseMirror's toJSON()
    // omits the content array entirely when a node has no children.
    if (json.type === "text") {
      ptx = ptx + encode(json.text || "");
    } else if (json.type === "hardBreak") {
      ptx = ptx + "\n";
    } else if (json.type === "rawptx" || json.type === "rawptxInline") {
      // An empty rawptx/rawptx-inline holds no source text. The wrapper is
      // synthetic (invented by cleanPtx), so there is nothing to emit —
      // deleting a chip's text deletes the wrapped element.
    } else {
      // An empty element node. The everyday case: pressing Enter in a
      // paragraph splits it and leaves a new, still-empty <p> — which must
      // serialize as <p></p> so the document stays well-formed XML and the
      // round-trip guard keeps editing enabled while the author types.
      // (This branch used to emit an XML comment complaining about an
      // unexpected node, which corrupted the saved document and tripped
      // the guard.) Attributes are kept; inline empties hug the text flow,
      // block empties get their own line, same as the non-empty case.
      const elementName = resolveName(json.type);
      ptx =
        ptx +
        "<" +
        elementName +
        attrString(json.attrs) +
        "></" +
        elementName +
        ">";
      if (!inlineTags.has(json.type)) {
        ptx = ptx + "\n";
      }
    }
  }
  return ptx;
}

export { json2ptx };
