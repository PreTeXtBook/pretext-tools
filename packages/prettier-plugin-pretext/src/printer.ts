import { builders } from "prettier/doc";
import embed from "./embed";
import { printChildrenWhenWhitespaceDoesNotMatter } from "./print-children";
import { isFragment, printIToken } from "./print-utils";
import type {
    ContentCstNode,
    Doc,
    Fragment,
    IToken,
    Path,
    Printer,
} from "./types";

const {
    fill,
    group,
    hardline,
    indent,
    join,
    line,
    literalline,
    softline,
    breakParent,
} = builders;

import {
    BREAK_AROUND_ELEMENTS,
    INDENTABLE_PRE_ELEMENTS,
    PAR_ELEMENTS,
    PRE_ELEMENTS,
} from "./pretext/special-nodes";
import { indentablePreToLines } from "./indentible-pre";

const ignoreStartComment = "<!-- prettier-ignore-start -->";
const ignoreEndComment = "<!-- prettier-ignore-end -->";

function isLine(
    item: any
): item is typeof line | typeof hardline | typeof softline {
    return item === line || item === hardline || item === softline;
}

function hasIgnoreRanges(comments: IToken[]) {
    if (!comments || comments.length === 0) {
        return false;
    }

    comments.sort((left, right) => left.startOffset - right.startOffset);

    let startFound = false;
    for (let idx = 0; idx < comments.length; idx += 1) {
        if (comments[idx].image === ignoreStartComment) {
            startFound = true;
        } else if (startFound && comments[idx].image === ignoreEndComment) {
            return true;
        }
    }

    return false;
}

function isWhitespaceIgnorable(node: ContentCstNode) {
    const { CData, Comment, reference } = node.children;

    return !CData && !reference && !hasIgnoreRanges(Comment);
}

function replaceNewlinesWithLiteralLines(content: string) {
    return content
        .split(/(\n)/g)
        .map((value, idx) => (idx % 2 === 0 ? value : literalline));
}

const printer: Printer = {
    print(path, opts, print) {
        const node = path.getValue();

        switch (node.name) {
            case "attribute": {
                const { Name, EQUALS, STRING } = node.children;

                return [Name[0].image, EQUALS[0].image, STRING[0].image];
            }
            case "chardata": {
                const { SEA_WS, TEXT } = node.children;
                const [{ image }] = SEA_WS || TEXT;

                return image
                    .split(/(\n)/g)
                    .map((value, index) =>
                        index % 2 === 0 ? value : literalline
                    );
            }
            case "content": {
                const nodePath = path as Path<typeof node>;

                let fragments = nodePath.call((childrenPath) => {
                    let response: Fragment[] = [];
                    const children = childrenPath.getValue();

                    if (children.CData) {
                        response = response.concat(
                            childrenPath.map(printIToken, "CData")
                        );
                    }

                    if (children.Comment) {
                        response = response.concat(
                            childrenPath.map(printIToken, "Comment")
                        );
                    }

                    if (children.chardata) {
                        response = response.concat(
                            childrenPath.map(
                                (charDataPath) => ({
                                    offset: charDataPath.getValue().location!
                                        .startOffset,
                                    printed: print(charDataPath),
                                }),
                                "chardata"
                            )
                        );
                    }

                    if (children.element) {
                        response = response.concat(
                            childrenPath.map(
                                (elementPath) => ({
                                    offset: elementPath.getValue().location!
                                        .startOffset,
                                    printed: print(elementPath),
                                }),
                                "element"
                            )
                        );
                    }

                    if (children.PROCESSING_INSTRUCTION) {
                        response = response.concat(
                            childrenPath.map(
                                printIToken,
                                "PROCESSING_INSTRUCTION"
                            )
                        );
                    }

                    if (children.reference) {
                        response = response.concat(
                            childrenPath.map((referencePath) => {
                                const referenceNode = referencePath.getValue();

                                return {
                                    offset: referenceNode.location!.startOffset,
                                    printed: (referenceNode.children.CharRef ||
                                        referenceNode.children.EntityRef)[0]
                                        .image,
                                };
                            }, "reference")
                        );
                    }

                    return response;
                }, "children");

                const { Comment } = node.children;

                if (hasIgnoreRanges(Comment)) {
                    Comment.sort(
                        (left, right) => left.startOffset - right.startOffset
                    );

                    const ignoreRanges: { start: number; end: number }[] = [];
                    let ignoreStart: IToken | null = null;

                    // Build up a list of ignored ranges from the original text based on the
                    // special prettier-ignore-* comments
                    Comment.forEach((comment) => {
                        if (comment.image === ignoreStartComment) {
                            ignoreStart = comment;
                        } else if (
                            ignoreStart &&
                            comment.image === ignoreEndComment
                        ) {
                            ignoreRanges.push({
                                start: ignoreStart.startOffset,
                                end: comment.endOffset!,
                            });

                            ignoreStart = null;
                        }
                    });

                    // Filter the printed children to only include the ones that are outside
                    // of each of the ignored ranges
                    fragments = fragments.filter((fragment) =>
                        ignoreRanges.every(
                            ({ start, end }) =>
                                fragment.offset < start || fragment.offset > end
                        )
                    );

                    // Push each of the ignored ranges into the child list as its own element
                    // so that the original content is still included
                    ignoreRanges.forEach(({ start, end }) => {
                        const content = opts.originalText.slice(start, end + 1);

                        fragments.push({
                            offset: start,
                            printed: replaceNewlinesWithLiteralLines(content),
                        });
                    });
                }

                fragments.sort((left, right) => left.offset - right.offset);
                return group(fragments.map(({ printed }) => printed));
            }
            case "docTypeDecl": {
                const { DocType, Name, externalID, CLOSE } = node.children;
                const parts: Doc[] = [DocType[0].image, " ", Name[0].image];

                if (externalID) {
                    parts.push(
                        " ",
                        path.call(print, "children", "externalID", 0)
                    );
                }

                return group([...parts, CLOSE[0].image]);
            }
            case "document": {
                const { docTypeDecl, element, misc, prolog } = node.children;
                const fragments: Fragment[] = [];

                if (docTypeDecl) {
                    fragments.push({
                        offset: docTypeDecl[0].location!.startOffset,
                        printed: path.call(print, "children", "docTypeDecl", 0),
                    });
                }

                if (prolog) {
                    fragments.push({
                        offset: prolog[0].location!.startOffset,
                        printed: path.call(print, "children", "prolog", 0),
                    });
                }

                if (misc) {
                    misc.forEach((node) => {
                        if (node.children.PROCESSING_INSTRUCTION) {
                            fragments.push({
                                offset: node.location!.startOffset,
                                printed:
                                    node.children.PROCESSING_INSTRUCTION[0]
                                        .image,
                            });
                        } else if (node.children.Comment) {
                            fragments.push({
                                offset: node.location!.startOffset,
                                printed: node.children.Comment[0].image,
                            });
                        }
                    });
                }

                if (element) {
                    fragments.push({
                        offset: element[0].location!.startOffset,
                        printed: path.call(print, "children", "element", 0),
                    });
                }

                fragments.sort((left, right) => left.offset - right.offset);

                const ret = [
                    join(
                        hardline,
                        fragments.map(({ printed }) => printed)
                    ),
                    hardline,
                ];
                return ret;
            }
            case "element": {
                const {
                    OPEN,
                    Name,
                    attribute,
                    START_CLOSE,
                    content,
                    SLASH_OPEN,
                    END_NAME,
                    END,
                    SLASH_CLOSE,
                } = node.children;
                const tagName = Name[0].image.trim();

                const parts: Doc[] = [OPEN[0].image, Name[0].image];

                if (attribute) {
                    const separator = opts.singleAttributePerLine
                        ? hardline
                        : line;
                    parts.push(
                        indent([
                            line,
                            join(
                                separator,
                                path.map(print, "children", "attribute")
                            ),
                        ])
                    );
                }

                // Determine the value that will go between the <, name, and attributes
                // of an element and the /> of an element.
                const space: Doc = line;

                if (SLASH_CLOSE) {
                    return group([...parts, " ", SLASH_CLOSE[0].image]);
                }

                if (Object.keys(content[0].children).length === 0) {
                    return group([...parts, space, "/>"]);
                }

                const openTag = group([
                    ...parts,
                    attribute ? softline : "",
                    START_CLOSE[0].image,
                ]);

                const closeTag = group([
                    SLASH_OPEN[0].image,
                    END_NAME[0].image,
                    END[0].image,
                ]);

                if (PRE_ELEMENTS.has(tagName)) {
                    // Elements that assume preformatted content should be printed verbatim
                    // to preserve all whitespace exactly. Even if there is an XML element as a child,
                    // we still want to print them exactly.
                    const startOffset = START_CLOSE[0].endOffset! + 1;
                    const endOffset = SLASH_OPEN[0].startOffset - 1;

                    const originalText = opts.originalText.slice(
                        startOffset,
                        endOffset + 1
                    );
                    // By replacing `\n` with `literalline`, we enable Prettier to accurately compute line lengths.
                    const verbDoc: Doc[] = originalText
                        .split(/(\n)/g)
                        .map((t) => (t === "\n" ? literalline : t));
                    return group([openTag, verbDoc, closeTag]);
                }

                if (INDENTABLE_PRE_ELEMENTS.has(tagName)) {
                    const startOffset = START_CLOSE[0].endOffset! + 1;
                    const endOffset = SLASH_OPEN[0].startOffset - 1;

                    const originalText = opts.originalText.slice(
                        startOffset,
                        endOffset
                    );
                    // By replacing `\n` with `literalline`, we enable Prettier to accurately compute line lengths.
                    const verbDoc: Doc = join(
                        hardline,
                        indentablePreToLines(originalText, opts.tabWidth)
                    );
                    return group([
                        openTag,
                        indent([softline, verbDoc]),
                        softline,
                        closeTag,
                    ]);
                }

                if (isWhitespaceIgnorable(content[0])) {
                    const inParMode = PAR_ELEMENTS.has(tagName);

                    const fragments = printChildrenWhenWhitespaceDoesNotMatter(
                        path,
                        print
                    );

                    if (fragments.length === 0) {
                        return group([...parts, "/>"]);
                    }

                    // If the only content of this tag is chardata, then use a softline so
                    // that we won't necessarily break (to allow <foo>bar</foo>).
                    // Actually, don't add any new lines here:
                    if (
                        fragments.length === 1 &&
                        (content[0].children.chardata || []).filter(
                            (chardata) => chardata.children.TEXT
                        ).length === 1
                    ) {
                        return group([
                            openTag,
                            [fragments[0].printed],
                            closeTag,
                        ]);
                    }

                    const docsAndFrags: (Doc | Fragment)[] = fragments.flatMap(
                        ((node, i) => {
                            const tagName = node.tagName;
                            const prevNode = fragments[i - 1];
                            if (!prevNode) {
                                return [softline, node];
                            }

                            // If there is a blank line, we preserve it
                            if (node.startLine! - prevNode.endLine! >= 2) {
                                return [hardline, hardline, node];
                            }

                            // If we immediately follow the previous node, don't insert any newlines if
                            // we are in par mode. This allows for things like `<m>x</m>.` where the period
                            // stays tight against the `</m>`.
                            if (
                                inParMode &&
                                !BREAK_AROUND_ELEMENTS.has(tagName || "") &&
                                node.offset - prevNode.endOffset! <= 1
                            ) {
                                return [node];
                            }

                            if (BREAK_AROUND_ELEMENTS.has(tagName || "")) {
                                return [node];
                            }

                            // If the previous node was a break-around node, it already placed a hardline,
                            // so we don't need to place an additional line.
                            return [line, node.printed];
                        }) as (node: Fragment, i: number) => (Fragment | Doc)[]
                    );

                    let prevItem: Doc | Fragment | undefined;
                    const docsAndFragsWithLines: (Doc | Fragment)[] = [];

                    // Make sure that every break-around fragment is preceded by a hardline
                    for (const item of docsAndFrags) {
                        if (!prevItem) {
                            docsAndFragsWithLines.push(item);
                            prevItem = item;
                            continue;
                        }
                        if (
                            isFragment(item) &&
                            BREAK_AROUND_ELEMENTS.has(item.tagName || "")
                        ) {
                            if (isLine(prevItem)) {
                                if (prevItem === line) {
                                    docsAndFragsWithLines.pop();
                                    docsAndFragsWithLines.push(hardline);
                                }
                            } else {
                                docsAndFragsWithLines.push(hardline);
                            }
                            docsAndFragsWithLines.push(item, hardline);
                            prevItem = item;
                            continue;
                        }
                        docsAndFragsWithLines.push(item);
                        prevItem = item;
                    }

                    const docs: Doc[] = docsAndFragsWithLines.map((item) =>
                        isFragment(item) ? item.printed : item
                    );

                    if (inParMode) {
                        return group([
                            openTag,
                            indent([softline, fill(docs)]),
                            softline,
                            closeTag,
                        ]);
                    }

                    const ret = group([
                        openTag,
                        indent(docs),
                        hardline,
                        closeTag,
                    ]);

                    return ret;
                }

                return group([
                    openTag,
                    indent(path.call(print, "children", "content", 0)),
                    closeTag,
                ]);
            }
            case "externalID": {
                const { Public, PubIDLiteral, System, SystemLiteral } =
                    node.children;

                if (System) {
                    return group([
                        System[0].image,
                        indent([line, SystemLiteral[0].image]),
                    ]);
                }

                return group([
                    group([
                        Public[0].image,
                        indent([line, PubIDLiteral[0].image]),
                    ]),
                    indent([line, SystemLiteral[0].image]),
                ]);
            }
            case "prolog": {
                const { XMLDeclOpen, attribute, SPECIAL_CLOSE } = node.children;
                const parts: Doc[] = [XMLDeclOpen[0].image];

                if (attribute) {
                    parts.push(
                        indent([
                            softline,
                            join(
                                line,
                                path.map(print, "children", "attribute")
                            ),
                        ])
                    );
                }

                const space = opts.xmlSelfClosingSpace ? line : softline;
                // Added hardline to separate the prolog from the content
                return [
                    group([...parts, space, SPECIAL_CLOSE[0].image]),
                    hardline,
                ];
            }

            default: {
                console.log("default", node);
                throw new Error("Unknown node type: " + (node as any).name);
            }
        }
    },
};

export default printer;
