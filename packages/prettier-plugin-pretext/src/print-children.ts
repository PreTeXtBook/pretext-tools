import { builders } from "prettier/doc";
import { printIToken } from "./print-utils";
import type { AnyNode, Fragment, Path, Print } from "./types";

const { fill, group, hardline, indent, join, line, literalline, softline } =
    builders;

/**
 * Prints the children of `path` but trims whitespace from the start/end and collapses
 * contiguous whitespace into a single char.  Inserts `line` between words, and `hardline`
 * after sentence-ending punctuation (.!?).
 */
export function printChildrenWhenWhitespaceDoesNotMatter(
    path: Path<AnyNode>,
    print: Print
) {
    const node = path.getNode();
    if (node == null || node.name !== "element") {
        throw new Error("Expected node with name `element`");
    }
    const nodePath = path as Path<typeof node>;

    const fragments = nodePath.call(
        (childrenPath) => {
            const children = childrenPath.getValue();
            const response: Fragment[] = [];

            if (children.Comment) {
                response.push(...childrenPath.map(printIToken, "Comment"));
            }

            if (children.chardata) {
                childrenPath.each((charDataPath) => {
                    const chardata = charDataPath.getValue();
                    if (!chardata.children.TEXT) {
                        return;
                    }

                    const rawText = chardata.children.TEXT[0].image;
                    const leadingWhitespace = rawText.match(/^\s*/)![0].length;
                    const trailingWhitespace = rawText.match(/\s*$/)![0].length;
                    const content = rawText.trim();
                    const printed = fill(
                        content.split(/(\s+|[.!?]\s+)/g).map((value) => {
                            if (value.match(/[.!?]\s+/)) {
                                // This will put a linebreak after any sentence-ending punctuation in chardata.
                                return [value.trim(), hardline];
                            } else if (value.match(/\s+/)) {
                                return line;
                            }
                            return value;
                        })
                    );

                    const location = chardata.location!;
                    response.push({
                        offset: location.startOffset + leadingWhitespace,
                        startLine: location.startLine,
                        endLine: location.endLine!,
                        endOffset: location.endOffset! - trailingWhitespace,
                        nodeType: "text",
                        printed,
                    } as Fragment);
                }, "chardata");
            }

            if (children.element) {
                response.push(
                    ...childrenPath.map((elementPath) => {
                        const node = elementPath.getValue();
                        const location = node.location!;
                        const tagName = node.children.Name[0]?.image?.trim();

                        return {
                            offset: location.startOffset,
                            startLine: location.startLine,
                            endLine: location.endLine!,
                            endOffset: location.endOffset,
                            nodeType: "element",
                            tagName,
                            printed: print(elementPath),
                        } as Fragment;
                    }, "element")
                );
            }

            if (children.PROCESSING_INSTRUCTION) {
                response.push(
                    ...childrenPath.map(printIToken, "PROCESSING_INSTRUCTION")
                );
            }

            return response;
        },
        "children",
        "content",
        0,
        "children"
    );

    fragments.sort((left, right) => left.offset - right.offset);

    return fragments;
}
