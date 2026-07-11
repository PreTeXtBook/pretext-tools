/**
 * Generic directive builder factory.
 *
 * Applies semantic rules from DirectiveSpec uniformly to all directives.
 * Pattern mirrors unified-latex-to-pretext's envFactory approach.
 *
 * This is the key insight: instead of separate buildTheoremLike(),
 * buildProofLike(), buildRemarkLike() functions, we have ONE function
 * that respects the spec's requiresStatement flag.
 */

import type { BlockContent, DefinitionContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { Element } from "xast";
import type { DirectiveSpec } from "./directive-map.js";
import { PROOF_SOLUTION_NAMES } from "./directive-map.js";
import type { VisitContext } from "./context.js";

type XastChild = Element | { type: "text"; value: string };

function el(
  name: string,
  children: XastChild[],
  attributes?: Record<string, string>,
): Element {
  return {
    type: "element",
    name,
    attributes: attributes ?? {},
    children: children as Element["children"],
  };
}

/**
 * Detect if a node is a task directive.
 * Tasks are only found inside exercise/project/task directives.
 */
function isTaskNode(node: BlockContent | DefinitionContent): boolean {
  return (
    node.type === "containerDirective" &&
    (node as ContainerDirective).name === "task"
  );
}

function isProofSolutionNode(node: BlockContent | DefinitionContent): boolean {
  return (
    node.type === "containerDirective" &&
    PROOF_SOLUTION_NAMES.has((node as ContainerDirective).name)
  );
}

/**
 * Nest lists inside paragraphs (PreTeXt spec requires lists in <p> tags).
 * Two strategies:
 * 1. If list follows a paragraph, append to that paragraph
 * 2. If list doesn't follow a paragraph (or is first), wrap it in a new <p>
 */
function nestListsInParagraphs(elements: Element[]): Element[] {
  const result: Element[] = [];

  for (const elem of elements) {
    if (elem.name === "ul" || elem.name === "ol") {
      if (result.length > 0 && result[result.length - 1]?.name === "p") {
        // Strategy 1: Append list to preceding paragraph
        (result[result.length - 1].children as XastChild[]).push(elem);
      } else {
        // Strategy 2: Wrap orphaned list in new <p>
        result.push(el("p", [elem]));
      }
    } else {
      result.push(elem);
    }
  }

  return result;
}

/**
 * Generic factory function: applies semantic rules from spec.
 *
 * Handles:
 * - Statement wrapping for theorem-like elements
 * - Task nesting with introduction wrapping (exercise/project/task)
 * - Proof/solution sibling extraction
 *
 * @param spec Semantic specification for this directive type
 * @param attrs HTML/XML attributes for the element
 * @param titleEl Optional <title> element (extracted from first paragraph if present)
 * @param children Body content of the directive
 * @param ctx Visitor context
 * @param convertBlock Callback to recursively convert block children
 * @param convertDirective Callback to recursively convert nested directives
 *
 * @returns XAST element for this directive
 */
export function buildDirectiveWithSpec(
  spec: DirectiveSpec,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
  convertBlock: (
    child: BlockContent | DefinitionContent,
    ctx: VisitContext,
  ) => Element | null,
  convertDirective: (
    node: ContainerDirective,
    ctx: VisitContext,
  ) => Element | null,
): Element {
  const result: Element[] = [];

  // Rule 1: Always add title first if present
  if (titleEl) {
    result.push(titleEl);
  }

  // Rule 2: Handle nested tasks (if spec supports them)
  if (spec.hasNestedTasks) {
    // Find first task node
    const firstTaskIndex = children.findIndex(isTaskNode);

    if (firstTaskIndex !== -1) {
      // Tasks exist: separate intro content, task nodes, and post-task content
      const taskIndexes: number[] = [];
      for (let i = 0; i < children.length; i++) {
        if (isTaskNode(children[i])) {
          taskIndexes.push(i);
        }
      }
      const lastTaskIndex = taskIndexes[taskIndexes.length - 1];
      const introContent = children.slice(0, firstTaskIndex);
      const taskNodes = children.slice(firstTaskIndex).filter(isTaskNode);
      const droppedBetweenTasks: Array<BlockContent | DefinitionContent> = [];
      const conclusionNodes: Array<BlockContent | DefinitionContent> = [];
      const proofNodes: ContainerDirective[] = [];

      for (let i = firstTaskIndex; i < children.length; i++) {
        const node = children[i];
        if (isTaskNode(node)) continue;

        if (i < lastTaskIndex) {
          droppedBetweenTasks.push(node);
          continue;
        }

        if (isProofSolutionNode(node)) {
          proofNodes.push(node as ContainerDirective);
          continue;
        }

        conclusionNodes.push(node);
      }

      if (droppedBetweenTasks.length > 0) {
        const messages = ctx.messages ?? (ctx.messages = []);
        messages.push({
          type: "warning",
          reason: `Dropped ${droppedBetweenTasks.length} non-task node(s) between task directives in ${spec.type}.`,
          category: "dropped-content-between-tasks",
          position: droppedBetweenTasks[0].position?.start,
        });
      }

      // Add introduction wrapper if intro content exists
      if (introContent.length > 0) {
        const introChildren = nestListsInParagraphs(
          introContent
            .map((child) => convertBlock(child, ctx))
            .filter((n): n is Element => n !== null),
        );
        if (introChildren.length > 0) {
          result.push(el("introduction", introChildren));
        }
      }

      // Add task elements
      for (const taskNode of taskNodes) {
        const converted = convertDirective(taskNode as ContainerDirective, ctx);
        if (converted) result.push(converted);
      }

      if (conclusionNodes.length > 0) {
        const conclusionChildren = nestListsInParagraphs(
          conclusionNodes
            .map((child) => convertBlock(child, ctx))
            .filter((n): n is Element => n !== null),
        );
        if (conclusionChildren.length > 0) {
          result.push(el("conclusion", conclusionChildren));
        }
      }

      // Add proof/solution siblings (not inside tasks)
      for (const proofNode of proofNodes) {
        const converted = convertDirective(proofNode, ctx);
        if (converted) result.push(converted);
      }
    } else {
      // No tasks found: fall back to statement/direct content logic
      // (will be handled in next rule)
      handleContentWithoutTasks(
        result,
        spec,
        children,
        ctx,
        convertBlock,
        convertDirective,
      );
    }
  } else {
    // No nested task support: handle normally
    handleContentWithoutTasks(
      result,
      spec,
      children,
      ctx,
      convertBlock,
      convertDirective,
    );
  }

  return el(spec.type, result, attrs);
}

/**
 * Handle content for directives that don't have nested tasks.
 * Applies statement wrapping and proof/solution separation rules.
 */
function handleContentWithoutTasks(
  result: Element[],
  spec: DirectiveSpec,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
  convertBlock: (
    child: BlockContent | DefinitionContent,
    ctx: VisitContext,
  ) => Element | null,
  convertDirective: (
    node: ContainerDirective,
    ctx: VisitContext,
  ) => Element | null,
): void {
  // Rule 2A: Apply requiresStatement rule
  if (spec.requiresStatement) {
    // Separate body content from proof/solution siblings
    const bodyContent: Array<BlockContent | DefinitionContent> = [];
    const siblings: Element[] = [];

    for (const child of children) {
      if (
        child.type === "containerDirective" &&
        PROOF_SOLUTION_NAMES.has((child as ContainerDirective).name)
      ) {
        const converted = convertDirective(child as ContainerDirective, ctx);
        if (converted) siblings.push(converted);
      } else {
        bodyContent.push(child);
      }
    }

    // Wrap body in <statement> (if body is non-empty)
    if (bodyContent.length > 0) {
      const statementChildren = nestListsInParagraphs(
        bodyContent
          .map((child) => convertBlock(child, ctx))
          .filter((n): n is Element => n !== null),
      );
      if (statementChildren.length > 0) {
        result.push(el("statement", statementChildren));
      }
    }

    // Append proof/solution siblings (not inside statement)
    result.push(...siblings);
  } else {
    // Rule 2B: No statement wrapping: convert all children directly
    const converted = nestListsInParagraphs(
      children
        .map((child) => convertBlock(child, ctx))
        .filter((n): n is Element => n !== null),
    );
    result.push(...converted);
  }
}
