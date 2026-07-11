/**
 * Return the amount of leading whitespace in `str`.
 */
function getLeadingWhitespace(str: string, tabWidth = 4): number {
    if (str.trim() === "") {
        return Number.MAX_VALUE;
    }
    let whitespace = 0;
    for (const char of str) {
        if (char.match(" ")) {
            whitespace += 1;
            continue;
        }
        if (char.match("\t")) {
            whitespace += tabWidth;
            continue;
        }
        break;
    }

    return whitespace;
}

/**
 * Get the number of characters which need to be trimmed off to trim off `maxWhitespaceLen` amount
 * of whitespace. This function takes care to count tabs as multiple whitespaces but as only one character.
 */
function getNumCharsForWhitespaceLen(
    str: string,
    maxWhitespaceLen: number,
    tabWidth = 4
): number {
    let chars = 0;
    let whitespace = 0;
    for (const c of str) {
        if (c.match(" ")) {
            chars += 1;
            whitespace += 1;
        } else if (c.match("\t")) {
            chars += 1;
            whitespace += tabWidth;
        } else {
            break;
        }

        if (whitespace > maxWhitespaceLen) {
            return chars - 1;
        }
        if (whitespace === maxWhitespaceLen) {
            return chars;
        }
    }
    return chars;
}

/**
 * Strip a uniform amount of space off the front of each line and return the lines separated
 * in an array.
 */
export function indentablePreToLines(rawText: string, tabWidth = 4): string[] {
    let lines = rawText.split("\n");
    const charsTrimmable = Math.min(
        ...lines.map((l) => getLeadingWhitespace(l, tabWidth))
    );
    if (charsTrimmable === 0) {
        return lines;
    }

    lines = lines.map((line) => {
        const trimPos = getNumCharsForWhitespaceLen(
            line,
            charsTrimmable,
            tabWidth
        );
        return line.slice(trimPos);
    });

    // We trim off any leading and trailing whitespace-only lines
    let leadingBlankLines = 0;
    let trailingBlankLines = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") {
            leadingBlankLines += 1;
        } else {
            break;
        }
    }
    for (let i = lines.length - 1; i > 0; i--) {
        if (lines[i].trim() === "") {
            trailingBlankLines += 1;
        } else {
            break;
        }
    }

    return lines.slice(leadingBlankLines, lines.length - trailingBlankLines);
}
