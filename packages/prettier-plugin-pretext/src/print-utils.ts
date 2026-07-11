import { Fragment, IToken, Path } from "./types";

export function printIToken(path: Path<IToken>): Fragment {
    const node = path.getValue();

    return {
        offset: node.startOffset,
        startLine: node.startLine,
        endLine: node.endLine,
        printed: node.image,
        endOffset: node.endOffset,
    };
}

export function isFragment(item: any): item is Fragment {
    if (typeof item === "object" && item.offset != null) {
        return true;
    }
    return false;
}
