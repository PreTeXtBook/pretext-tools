/**
 * Indentation-Based Directive Normalizer
 *
 * Transforms Python-like indentation-based directive syntax into colon syntax.
 *
 * INPUT (indentation-based):
 *   Theorem[Pythagorean]{#thm}:
 *     Statement text here.
 *
 *     Proof:
 *       Proof content.
 *
 *   Plain text (outdented).
 *
 * OUTPUT (colon-based):
 *   :::theorem[Pythagorean]{#thm}
 *   Statement text here.
 *
 *   ::::proof
 *   Proof content.
 *   ::::
 *   :::
 *
 *   Plain text (outdented).
 *
 * Algorithm:
 * 1. Track fenced code blocks (``` and ~~~) and skip directive detection inside them
 * 2. Parse each line to detect directive markers (Keyword[...]{...}:)
 * 3. Track indentation stack: when indent increases, open a block; when decreases, close block(s)
 * 4. Remove relative indentation from content lines inside directives
 * 5. Convert to colon syntax with proper nesting depth (validated against DIRECTIVE_SPEC_TABLE)
 * 6. Preserve all non-directive content and indentation outside directives and code fences
 */

import { DIRECTIVE_SPEC_TABLE } from './directive-map.js';

interface IndentationState {
  level: number; // Current indentation level (in spaces/tabs)
  openDirectives: DirectiveOpen[]; // Stack of open directives
  inCodeFence: boolean; // True if currently inside a fenced code block
  codeFenceMarker: string | null; // The marker used to open the fence (``` or ~~~)
}

interface DirectiveOpen {
  label: string; // The directive name with attributes (e.g., "theorem[Pythagorean]{#thm}")
  indentLevel: number; // Indentation level where this directive opened
  baselineIndent: number; // Baseline: amount of indentation to remove from content (the marker's own indent)
  colonCount: number; // Colon count to use (computed based on nesting)
}

/**
 * Detect if a line is a directive marker (e.g., "Theorem[Title]{#id}:")
 * Returns the label if it is, null otherwise.
 * Only accepts directive names that exist in DIRECTIVE_SPEC_TABLE.
 * 
 * Attributes must follow the pattern: [optional title] {optional attributes}
 * or be empty. Reject arbitrary trailing text like "Proof by contradiction:".
 */
function parseIndentationDirective(line: string): string | null {
  const trimmed = line.trim();
  
  // Must end with colon
  if (!trimmed.endsWith(':')) return null;
  
  // Remove trailing colon
  const withoutColon = trimmed.slice(0, -1);
  
  // Must start with a word character (directive name)
  if (!/^[a-zA-Z]/.test(withoutColon)) return null;
  
  // Extract directive name (word characters, hyphens, underscores)
  // Attributes must be either empty or follow pattern: [...]+ {...}+
  const match = withoutColon.match(/^([a-zA-Z][a-zA-Z0-9_-]*)(.*)$/);
  if (!match) return null;
  
  const [, directiveName, attributes] = match;
  
  // Validate attributes: must be empty or contain only bracket/brace syntax
  // Reject lines like "Proof by contradiction:" where there's arbitrary text after the directive name
  if (attributes && !/^(\[.*?\]|\{.*?\})*$/.test(attributes)) {
    // There's trailing text that isn't [...]/{...} syntax
    return null;
  }
  
  // Validate against DIRECTIVE_SPEC_TABLE (single source of truth)
  if (!DIRECTIVE_SPEC_TABLE[directiveName.toLowerCase()]) {
    return null;
  }
  
  // Return the full label (directive + attributes, without colon)
  return withoutColon;
}

/**
 * Get the indentation level of a line (in spaces; treat tabs as 4 spaces)
 */
function getIndentLevel(line: string): number {
  let level = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') {
      level += 1;
    } else if (line[i] === '\t') {
      level += 4;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Check if the next non-blank line is indented deeper than current line.
 * This determines if current line should be treated as directive marker.
 */
function hasIndentedBody(lines: string[], currentIndex: number): boolean {
  const currentIndent = getIndentLevel(lines[currentIndex]);
  
  // Look ahead for the next non-blank line
  for (let i = currentIndex + 1; i < lines.length; i++) {
    if (!isBlankLine(lines[i])) {
      const nextIndent = getIndentLevel(lines[i]);
      return nextIndent > currentIndent;
    }
  }
  
  // No indented body found
  return false;
}

/**
 * Remove leading indentation from a line by a fixed amount
 */
function removeIndentAmount(line: string, amountToRemove: number): string {
  let removed = 0;
  let i = 0;
  
  // Remove up to amountToRemove spaces/tabs
  while (i < line.length && removed < amountToRemove) {
    if (line[i] === ' ') {
      removed += 1;
      i += 1;
    } else if (line[i] === '\t') {
      removed += 4;
      i += 1;
    } else {
      break;
    }
  }
  
  return line.slice(i);
}

/**
 * Check if a line is blank or whitespace-only
 */
function isBlankLine(line: string): boolean {
  return line.trim() === '';
}

/**
 * Normalize indentation-based syntax to colon-based syntax
 */
export function normalizeIndentationDirectives(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  const stack: IndentationState = {
    level: 0,
    openDirectives: [],
    inCodeFence: false,
    codeFenceMarker: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const indentLevel = getIndentLevel(line);

    // Check for code fence markers (``` or ~~~) - toggle fence state
    const codeFenceMatch = trimmedLine.match(/^(`{3,}|~{3,})/);
    if (codeFenceMatch) {
      const marker = codeFenceMatch[1];
      if (!stack.inCodeFence) {
        // Opening a new fence
        stack.inCodeFence = true;
        stack.codeFenceMarker = marker;
      } else if (stack.codeFenceMarker && trimmedLine.startsWith(stack.codeFenceMarker)) {
        // Closing the fence
        stack.inCodeFence = false;
        stack.codeFenceMarker = null;
      }
      
      // Output fence lines: if inside a directive, keep original indentation
      // remark-directive will handle dedenting the body
      output.push(line);
      continue;
    }

    // Inside a code fence: output as-is, remark-directive will handle dedenting
    if (stack.inCodeFence) {
      output.push(line);
      continue;
    }

    // Blank lines are always preserved
    if (isBlankLine(line)) {
      output.push('');
      continue;
    }

    // Check if this line is a directive marker (only if not in code fence)
    const directiveLabel = parseIndentationDirective(trimmedLine);

    if (directiveLabel && hasIndentedBody(lines, i)) {
      // Only treat as directive if there's actually an indented body following
      // Close any directives that are at or deeper than this indentation level
      while (stack.openDirectives.length > 0) {
        const topDirective = stack.openDirectives[stack.openDirectives.length - 1];
        if (topDirective.indentLevel < indentLevel) {
          // This directive is a parent; keep it open
          break;
        }
        // Close this directive
        const closing = stack.openDirectives.pop();
        if (closing) {
          output.push(':'.repeat(closing.colonCount));
        }
      }

      // Extract directive name and lowercase it for output
      // directiveLabel is like "Theorem[...]" or "theorem[...]" etc.
      const nameMatch = directiveLabel.match(/^([a-zA-Z][a-zA-Z0-9_-]*)(.*)/);
      const lowercaseLabel = nameMatch ? nameMatch[1].toLowerCase() + (nameMatch[2] || '') : directiveLabel;

      // Compute colon count for the new directive
      // It should be max(children's colons) + 1
      // Children are directives opened at deeper indent levels
      const colonCount = (stack.openDirectives.length * 1) + 3; // 3 is the base
      
      // Open the new directive with colon syntax (lowercase directive name)
      output.push(':'.repeat(colonCount) + lowercaseLabel);
      stack.openDirectives.push({
        label: lowercaseLabel,
        indentLevel,
        baselineIndent: indentLevel, // Track the directive marker's indentation
        colonCount,
      });
      stack.level = indentLevel;
    } else {
      // Regular content line

      // Check if we need to close any directives
      // (outdenting beyond the current directive's level)
      while (
        stack.openDirectives.length > 0 &&
        indentLevel <= stack.openDirectives[stack.openDirectives.length - 1].indentLevel
      ) {
        const closing = stack.openDirectives.pop();
        if (closing) {
          output.push(':'.repeat(closing.colonCount));
        }
      }

      // If we're inside a directive, preserve the original line as-is
      // remark-directive will handle extracting and dedenting the body
      if (stack.openDirectives.length > 0) {
        output.push(line);
      } else {
        // Outside any directive, preserve the original line
        output.push(line);
      }
      stack.level = indentLevel;
    }
  }

  // Close any remaining open directives
  while (stack.openDirectives.length > 0) {
    const closing = stack.openDirectives.pop();
    if (closing) {
      output.push(':'.repeat(closing.colonCount));
    }
  }

  return output.join('\n');
}
