import { SaxesParser } from "saxes";
import type {
  CompletionContext,
  CompletionItem,
  Grammar,
  Position,
} from "./types";

/** CompletionItemKind numeric values (mirrors vscode-languageserver-types). */
const Kind = {
  Class: 7,
  Property: 10,
};

const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** Conventional prefixes for the namespaces PreTeXt uses. */
const NS_PREFIXES: Record<string, string> = {
  "http://www.w3.org/XML/1998/namespace": "xml",
  "http://www.w3.org/2001/XInclude": "xi",
};

/** Render a name as it would appear in source, prefixing known namespaces. */
function qualify(ns: string | undefined, name: string): string {
  if (ns && NS_PREFIXES[ns]) {
    return `${NS_PREFIXES[ns]}:${name}`;
  }
  return name;
}

interface WalkerLike {
  fireEvent(name: string, params: string[]): false | unknown[];
  possible(): Iterable<PossibleEvent>;
  possibleAttributes?(): Iterable<PossibleEvent>;
}

interface PossibleEvent {
  name: string;
  namePattern?: {
    toArray?: () => Array<NameObj> | null;
    toObject?: () => NameObj;
  };
}

interface NameObj {
  ns?: string;
  name?: string;
  documentation?: string;
}

/**
 * Context-aware completions driven by salve's `walker.possible()`. Handles two
 * cases: completing an element name (in content, or after `<`) and completing an
 * attribute name (inside an open start tag).
 */
export function getCompletions(context: CompletionContext): CompletionItem[] {
  const { text, position, grammar } = context;
  const offset = positionToOffset(text, position);
  const prefix = text.slice(0, offset);

  const lastLt = prefix.lastIndexOf("<");
  const lastGt = prefix.lastIndexOf(">");
  const insideTag = lastLt > lastGt;

  if (!insideTag) {
    // In element content: offer child elements of the current open element.
    return elementCompletions(grammar, prefix, "");
  }

  const tagText = prefix.slice(lastLt);
  if (
    tagText.startsWith("</") ||
    tagText.startsWith("<!") ||
    tagText.startsWith("<?")
  ) {
    return [];
  }

  const nameMatch = tagText.match(/^<([A-Za-z_][\w.:-]*)?/);
  const tagName = nameMatch?.[1] ?? "";
  const afterName = tagText.slice(1 + tagName.length);

  if (!/\s/.test(afterName)) {
    // Still typing the element name.
    return elementCompletions(grammar, prefix.slice(0, lastLt), tagName);
  }

  // Typing an attribute (or its value). Offer attribute names for this element.
  const attrPartial = currentAttributePartial(tagText);
  if (attrPartial === null) {
    return []; // inside an attribute value — nothing to offer here yet
  }
  return attributeCompletions(
    grammar,
    prefix.slice(0, lastLt),
    tagName,
    tagText,
    attrPartial,
  );
}

function elementCompletions(
  grammar: Grammar,
  cleanPrefix: string,
  partial: string,
): CompletionItem[] {
  const walker = buildWalker(grammar, cleanPrefix);
  if (!walker) {
    return [];
  }
  const names = collectNames(walker.possible(), "enterStartTag");
  return toItems(names, partial, Kind.Class);
}

function attributeCompletions(
  grammar: Grammar,
  cleanPrefix: string,
  tagName: string,
  tagText: string,
  partial: string,
): CompletionItem[] {
  const walker = buildWalker(grammar, cleanPrefix);
  if (!walker) {
    return [];
  }
  // Enter the element being typed, and replay any attributes already present so
  // the offered set excludes them.
  const ret = walker.fireEvent("enterStartTag", ["", tagName]);
  if (Array.isArray(ret)) {
    // Element not valid here; no meaningful attribute suggestions.
    return [];
  }
  // Names (qualified, e.g. "xml:id") already written in the start tag.
  const present = new Set(
    existingAttributes(tagText).map((a) => a.name),
  );

  const source = walker.possibleAttributes
    ? walker.possibleAttributes()
    : walker.possible();
  const names = collectNames(source, "attributeName").filter(
    (n) => !present.has(qualify(n.ns, n.name!)),
  );
  return toItems(names, partial, Kind.Property);
}

/** Parse `cleanPrefix` into a walker positioned inside the innermost open element. */
function buildWalker(grammar: Grammar, cleanPrefix: string): WalkerLike | null {
  const walker = grammar.newWalker() as WalkerLike;
  const parser = new SaxesParser<{ xmlns: true; position: true }>({
    xmlns: true,
    position: true,
  });
  let depth = 0;
  let failed = false;

  const fire = (name: string, params: string[]) => {
    if (failed) {
      return;
    }
    walker.fireEvent(name, params); // ignore errors: we only want walker state
  };

  parser.on("opentag", (node) => {
    depth++;
    fire("enterStartTag", [node.uri ?? "", node.local ?? node.name]);
    for (const key of Object.keys(node.attributes)) {
      const attr = node.attributes[key] as {
        uri?: string;
        prefix?: string;
        local?: string;
        name: string;
        value: string;
      };
      if (attr.prefix === "xmlns" || attr.name === "xmlns" || attr.uri === XMLNS_NS) {
        continue;
      }
      fire("attributeName", [attr.uri ?? "", attr.local ?? attr.name]);
      fire("attributeValue", [attr.value]);
    }
    fire("leaveStartTag", []);
  });
  parser.on("closetag", (node) => {
    fire("endTag", [node.uri ?? "", node.local ?? node.name]);
    depth = Math.max(0, depth - 1);
  });
  parser.on("text", (t) => {
    if (depth > 0 && t.length > 0) {
      fire("text", [t]);
    }
  });
  parser.on("error", () => {
    failed = true;
  });

  try {
    parser.write(cleanPrefix);
  } catch {
    // Incomplete trailing token is expected; state up to here is still usable.
  }
  return walker;
}

function collectNames(
  events: Iterable<PossibleEvent>,
  eventName: string,
): NameObj[] {
  const seen = new Set<string>();
  const out: NameObj[] = [];
  for (const ev of events) {
    if (ev.name !== eventName || !ev.namePattern) {
      continue;
    }
    const arr = ev.namePattern.toArray?.();
    const names = arr
      ? arr
      : ev.namePattern.toObject
        ? [ev.namePattern.toObject()]
        : [];
    for (const n of names) {
      if (!n || typeof n.name !== "string") {
        continue;
      }
      const key = `${n.ns ?? ""}:${n.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

function toItems(
  names: NameObj[],
  partial: string,
  kind: number,
): CompletionItem[] {
  const lower = partial.toLowerCase();
  return names
    .map((n) => ({ display: qualify(n.ns, n.name!), doc: n.documentation }))
    .filter((n) => n.display.toLowerCase().startsWith(lower))
    .sort((a, b) => a.display.localeCompare(b.display))
    .map((n) => {
      const item: CompletionItem = {
        label: n.display,
        kind: kind as CompletionItem["kind"],
      };
      if (n.doc) {
        item.documentation = n.doc;
      }
      return item;
    });
}

/**
 * Returns the partially-typed attribute name at the end of `tagText`, or null if
 * the cursor is inside an attribute value (`="…`).
 */
function currentAttributePartial(tagText: string): string | null {
  // Count quotes after the tag name to detect being inside a value.
  const afterFirstSpace = tagText.replace(/^<[\w.:-]*/, "");
  let inValue = false;
  let quote = "";
  for (let i = 0; i < afterFirstSpace.length; i++) {
    const c = afterFirstSpace[i];
    if (inValue) {
      if (c === quote) {
        inValue = false;
      }
    } else if (c === '"' || c === "'") {
      inValue = true;
      quote = c;
    }
  }
  if (inValue) {
    return null;
  }
  const tail = tagText.match(/([A-Za-z_][\w.:-]*)?$/);
  return tail?.[1] ?? "";
}

/** Extract already-written attributes from an in-progress start tag. */
function existingAttributes(tagText: string): Array<{ name: string; value: string }> {
  const attrs: Array<{ name: string; value: string }> = [];
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagText)) !== null) {
    attrs.push({ name: m[1], value: m[3] ?? m[4] ?? "" });
  }
  return attrs;
}

function positionToOffset(text: string, position: Position): number {
  let line = 0;
  let offset = 0;
  while (line < position.line) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) {
      return text.length;
    }
    offset = nl + 1;
    line++;
  }
  return Math.min(text.length, offset + position.character);
}
