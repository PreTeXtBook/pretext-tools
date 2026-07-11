import { builders, utils } from "prettier/doc";
import {
    AnyNode,
    ContentCtx,
    Doc,
    ElementCstNode,
    Embed,
    Options,
    Path,
} from "./types";

const {
    dedentToRoot,
    group,
    hardline,
    indent,
    join,
    line,
    literalline,
    softline,
} = builders;

// Replace the string content newlines within a doc tree with literallines so
// that all of the indentation lines up appropriately
function replaceNewlines(doc: Doc) {
    return utils.mapDoc(doc, (currentDoc) =>
        typeof currentDoc === "string" && currentDoc.includes("\n")
            ? currentDoc
                  .split(/(\n)/g)
                  .map((v, i) => (i % 2 === 0 ? v : literalline))
            : currentDoc
    );
}

// Get the start and end element tags from the current node on the tree
function getElementTags(
    path: Path<ElementCstNode>,
    opts: Options,
    print: (path: Path<AnyNode>) => Doc
) {
    const node = path.getValue();
    const { OPEN, Name, attribute, START_CLOSE, SLASH_OPEN, END_NAME, END } =
        node.children;

    const parts: Doc[] = [OPEN[0].image, Name[0].image];

    if (attribute) {
        parts.push(
            indent([line, join(line, path.map(print, "children", "attribute"))])
        );
    }

    if (!opts.bracketSameLine) {
        parts.push(softline);
    }

    return {
        openTag: group([...parts, START_CLOSE[0].image]),
        closeTag: group([SLASH_OPEN[0].image, END_NAME[0].image, END[0].image]),
    };
}

// Get the name of the parser that is represented by the given element node,
// return null if a matching parser cannot be found
function getParser(node: ElementCstNode, opts: Options) {
    const { Name, attribute } = node.children;
    const parser = Name[0].image.toLowerCase();

    // We don't want to deal with some weird recursive parser situation, so we
    // need to explicitly call out the XML parser here and just return null
    if (parser === "ptx") {
        return null;
    }

    // If this is a style tag with a text/css type, then we can skip straight to
    // saying that this needs a CSS parser
    if (
        parser === "style" &&
        attribute &&
        attribute.some(
            (attr) =>
                attr.children.Name[0].image === "type" &&
                attr.children.STRING[0].image === '"text/css"'
        )
    ) {
        return "css";
    }

    // If there is a plugin that has a parser that matches the name of this
    // element, then we're going to assume that's correct for embedding and go
    // ahead and switch to that parser
    if (
        opts.plugins.some(
            (plugin) =>
                typeof plugin !== "string" &&
                !(plugin instanceof URL) &&
                plugin.parsers &&
                Object.prototype.hasOwnProperty.call(plugin.parsers, parser)
        )
    ) {
        return parser;
    }

    return null;
}

// Get the source string that will be passed into the embedded parser from the
// content of the inside of the element node
function getSource(content: ContentCtx) {
    return content.chardata
        .map((node) => {
            const { SEA_WS, TEXT } = node.children;
            const [{ image }] = SEA_WS || TEXT;

            return {
                offset: node.location!.startOffset,
                printed: image,
            };
        })
        .sort(({ offset }) => offset)
        .map(({ printed }) => printed)
        .join("");
}

const embed: Embed = (path, opts) => {
    // Disable the embed
    return null;
};

export default embed;
