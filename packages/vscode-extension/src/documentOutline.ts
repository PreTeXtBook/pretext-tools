/**
 * Document Outline for PreTeXt documents.
 *
 * Provides a tree view in the Activity Bar sidebar that shows the
 * hierarchical structure of the currently open .ptx file:
 * sections, subsections, figures, tables, equations, etc.
 *
 * Each item is clickable and jumps to the corresponding line in the source.
 * The tree updates automatically when the document changes or when a
 * different .ptx file is opened.
 */

import {
  Event,
  EventEmitter,
  Position,
  Range,
  Selection,
  TextDocument,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
  Disposable,
} from "vscode";

/**
 * Check if a filename is a PreTeXt source file (.ptx or .xml).
 */
function isPretextFile(fileName: string): boolean {
  return fileName.endsWith(".ptx") || fileName.endsWith(".xml");
}

/**
 * Represents a single node in the document outline tree.
 */
class OutlineNode {
  constructor(
    public readonly tag: string,
    public readonly title: string,
    public readonly xmlId: string,
    public readonly line: number,
    public readonly character: number,
    public readonly children: OutlineNode[],
    public readonly uri: Uri,
  ) {}
}

/**
 * Maps PreTeXt element tags to display icons and labels.
 */
const ELEMENT_CONFIG: Record<
  string,
  { icon: string; label: string }
> = {
  book: { icon: "book", label: "Book" },
  article: { icon: "book", label: "Article" },
  frontmatter: { icon: "info", label: "Front Matter" },
  backmatter: { icon: "info", label: "Back Matter" },
  chapter: { icon: "symbol-class", label: "Chapter" },
  section: { icon: "symbol-class", label: "Section" },
  subsection: { icon: "symbol-method", label: "Subsection" },
  subsubsection: { icon: "symbol-field", label: "Subsubsection" },
  paragraphs: { icon: "symbol-text", label: "Paragraphs" },
  references: { icon: "references", label: "References" },
  appendix: { icon: "symbol-class", label: "Appendix" },
};

// Only these tags appear in the outline — section headings and structural containers
const OUTLINE_TAGS = new Set(Object.keys(ELEMENT_CONFIG));

// Tags that can contain other outline-relevant elements
const CONTAINER_TAGS = new Set([
  "book",
  "article",
  "frontmatter",
  "backmatter",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "appendix",
]);

/**
 * TreeDataProvider that parses a .ptx file and provides the document
 * structure as a tree for the VS Code sidebar.
 */
export class PretextDocumentOutlineProvider
  implements TreeDataProvider<OutlineNode>
{
  private _onDidChangeTreeData = new EventEmitter<
    OutlineNode | undefined | null
  >();
  readonly onDidChangeTreeData: Event<OutlineNode | undefined | null> =
    this._onDidChangeTreeData.event;

  private roots: OutlineNode[] = [];
  private disposables: Disposable[] = [];

  constructor() {
    // Update when the active editor changes
    this.disposables.push(
      window.onDidChangeActiveTextEditor(() => {
        this.refresh();
      }),
    );

    // Update when the document is edited
    this.disposables.push(
      workspace.onDidChangeTextDocument((e) => {
        if (
          window.activeTextEditor &&
          e.document === window.activeTextEditor.document &&
          isPretextFile(e.document.fileName)
        ) {
          this.refresh();
        }
      }),
    );

    // Initial parse
    this.refresh();
  }

  /**
   * Re-parse the current document and refresh the tree.
   */
  refresh(): void {
    const editor = window.activeTextEditor;
    if (editor && isPretextFile(editor.document.fileName)) {
      this.roots = this.parseDocument(editor.document);
    } else {
      this.roots = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: OutlineNode): TreeItem {
    const config = ELEMENT_CONFIG[element.tag];
    const hasChildren = element.children.length > 0;

    const item = new TreeItem(
      this.getDisplayLabel(element),
      hasChildren
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None,
    );

    // Set icon
    if (config) {
      item.iconPath = new ThemeIcon(config.icon);
    }

    // Set tooltip
    if (element.xmlId) {
      item.tooltip = `${config?.label || element.tag}: ${element.title}\nxml:id="${element.xmlId}"`;
    } else {
      item.tooltip = `${config?.label || element.tag}: ${element.title}`;
    }

    // Set description (shown dimmed to the right of the label)
    if (element.xmlId) {
      item.description = element.xmlId;
    }

    // Click to jump to source line
    item.command = {
      command: "pretext-tools.outlineJumpToLine",
      title: "Go to",
      arguments: [element],
    };

    return item;
  }

  getChildren(element?: OutlineNode): OutlineNode[] {
    if (!element) {
      return this.roots;
    }
    return element.children;
  }

  /**
   * Generate a human-readable label for the tree item.
   */
  private getDisplayLabel(node: OutlineNode): string {
    if (node.title) {
      return node.title;
    }
    const config = ELEMENT_CONFIG[node.tag];
    if (config) {
      return config.label;
    }
    return node.tag;
  }

  /**
   * Parse a .ptx document into a tree of OutlineNodes.
   *
   * Uses a simple line-by-line regex approach (not a full XML parser)
   * to handle potentially malformed/incomplete XML that the user is
   * actively editing. This is intentionally tolerant of errors.
   */
  private parseDocument(document: TextDocument): OutlineNode[] {
    const text = document.getText();
    const uri = document.uri;
    const roots: OutlineNode[] = [];

    // Stack to track nesting: each entry is [tag, node]
    const stack: Array<{ tag: string; node: OutlineNode }> = [];

    // Regex to find opening and closing tags of interest
    // We process line by line for simplicity and error tolerance
    const lines = text.split("\n");
    let inComment = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Skip XML comments (simple heuristic — not perfect but good enough)
      if (line.includes("<!--")) {
        inComment = true;
      }
      if (inComment) {
        if (line.includes("-->")) {
          inComment = false;
        }
        continue;
      }

      // Check for closing tags — pop the stack
      for (const tag of OUTLINE_TAGS) {
        const closePattern = new RegExp(`</${tag}\\s*>`);
        if (closePattern.test(line)) {
          // Pop until we find the matching open tag
          while (stack.length > 0) {
            const top = stack[stack.length - 1];
            stack.pop();
            if (top.tag === tag) {
              break;
            }
          }
        }
      }

      // Check for opening tags
      for (const tag of OUTLINE_TAGS) {
        const openPattern = new RegExp(
          `<${tag}(?:\\s|>|/)`,
        );
        const openMatch = openPattern.exec(line);
        if (!openMatch) {
          continue;
        }

        // Extract xml:id if present (might be on this line or the next few)
        let xmlId = "";
        const idMatch = line.match(/xml:id=["']([^"']+)["']/);
        if (idMatch) {
          xmlId = idMatch[1];
        }

        // Extract title — look for <title>...</title> in the next few lines
        const displayTitle = this.extractTitle(lines, lineNum);

        const node = new OutlineNode(
          tag,
          displayTitle,
          xmlId,
          lineNum,
          openMatch.index,
          [],
          uri,
        );

        // Add to parent's children or to roots
        if (stack.length > 0) {
          const parent = stack[stack.length - 1];
          parent.node.children.push(node);
        } else {
          roots.push(node);
        }

        // If this tag can contain children, push it onto the stack
        if (CONTAINER_TAGS.has(tag)) {
          stack.push({ tag, node });
        }

        // Only match the first outline tag per line
        break;
      }
    }

    return roots;
  }

  /**
   * Extract the text content of a <title>...</title> element
   * starting from the given line. Looks ahead up to 5 lines.
   */
  private extractTitle(lines: string[], startLine: number): string {
    const searchWindow = lines
      .slice(startLine, Math.min(startLine + 8, lines.length))
      .join("\n");

    // Single-line title: <title>Text Here</title>
    const singleLine = searchWindow.match(
      /<title>(.*?)<\/title>/,
    );
    if (singleLine) {
      return this.cleanText(singleLine[1]);
    }

    // Multi-line title: <title>\nText Here\n</title>
    const multiLine = searchWindow.match(
      /<title>\s*([\s\S]*?)\s*<\/title>/,
    );
    if (multiLine) {
      return this.cleanText(multiLine[1]);
    }

    return "";
  }

  /**
   * Extract the text content of a <caption>...</caption> element.
   */
  private extractCaption(lines: string[], startLine: number): string {
    const searchWindow = lines
      .slice(startLine, Math.min(startLine + 10, lines.length))
      .join("\n");

    const match = searchWindow.match(
      /<caption>([\s\S]*?)<\/caption>/,
    );
    if (match) {
      const text = this.cleanText(match[1]);
      // Truncate long captions
      if (text.length > 60) {
        return text.substring(0, 57) + "...";
      }
      return text;
    }

    return "";
  }

  /**
   * Clean extracted text: strip XML tags, collapse whitespace.
   */
  private cleanText(text: string): string {
    return text
      .replace(/<[^>]+>/g, "") // Remove XML tags
      .replace(/\s+/g, " ") // Collapse whitespace
      .trim();
  }

  /**
   * Dispose of event listeners.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

/**
 * Command handler: jump to the source line of an outline node.
 */
export function cmdOutlineJumpToLine(node: OutlineNode): void {
  if (!node) {
    return;
  }

  // Find the document — it might not be the active editor
  const editor = window.activeTextEditor;
  if (editor && editor.document.uri.toString() === node.uri.toString()) {
    const pos = new Position(node.line, node.character);
    editor.revealRange(new Range(pos, pos), 2); // InCenter
    editor.selection = new Selection(pos, pos);
    // Also focus the editor (in case the sidebar has focus)
    window.showTextDocument(editor.document, editor.viewColumn);
  } else {
    // Open the document
    workspace.openTextDocument(node.uri).then((doc) => {
      window.showTextDocument(doc).then((ed) => {
        const pos = new Position(node.line, node.character);
        ed.revealRange(new Range(pos, pos), 2);
        ed.selection = new Selection(pos, pos);
      });
    });
  }
}
