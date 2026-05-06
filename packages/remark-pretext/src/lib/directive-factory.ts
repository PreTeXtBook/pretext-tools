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

import type { BlockContent, DefinitionContent } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { Element } from 'xast';
import type { DirectiveSpec } from './directive-map.js';
import { PROOF_SOLUTION_NAMES } from './directive-map.js';
import type { VisitContext } from './context.js';

type XastChild = Element | { type: 'text'; value: string };

function el(
  name: string,
  children: XastChild[],
  attributes?: Record<string, string>,
): Element {
  return {
    type: 'element',
    name,
    attributes: attributes ?? {},
    children: children as Element['children'],
  };
}

/**
 * Detect if a node is a task directive.
 * Tasks are only found inside exercise/project/task directives.
 */
function isTaskNode(node: BlockContent | DefinitionContent): boolean {
  return (
    node.type === 'containerDirective' &&
    (node as ContainerDirective).name === 'task'
  );
}

/**
 * Nest lists inside preceding paragraphs (PreTeXt spec requires lists in <p> tags).
 * Applies the same logic as convertBlockSequence to maintain consistency.
 */
function nestListsInParagraphs(elements: Element[]): Element[] {
  const result: Element[] = [];

  for (const el of elements) {
    // Nest lists inside preceding paragraphs
    if ((el.name === 'ul' || el.name === 'ol') && result.length > 0) {
      const prev = result[result.length - 1];
      if (prev?.name === 'p') {
        // Append list to preceding paragraph
        (prev.children as XastChild[]).push(el);
        continue;
      }
    }

    result.push(el);
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
  convertBlock: (child: BlockContent | DefinitionContent, ctx: VisitContext) => Element | null,
  convertDirective: (node: ContainerDirective, ctx: VisitContext) => Element | null,
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
      // Tasks exist: separate intro content from task nodes
      const introContent = children.slice(0, firstTaskIndex);
      const taskNodes = children.slice(firstTaskIndex).filter(isTaskNode);
      const proofNodes = children.slice(firstTaskIndex).filter(
        (node) => node.type === 'containerDirective' && PROOF_SOLUTION_NAMES.has((node as ContainerDirective).name)
      );

      // Add introduction wrapper if intro content exists
      if (introContent.length > 0) {
        const introChildren = nestListsInParagraphs(
          introContent
            .map((child) => convertBlock(child, ctx))
            .filter((n): n is Element => n !== null)
        );
        if (introChildren.length > 0) {
          result.push(el('introduction', introChildren));
        }
      }

      // Add task elements
      for (const taskNode of taskNodes) {
        const converted = convertDirective(taskNode as ContainerDirective, ctx);
        if (converted) result.push(converted);
      }

      // Add proof/solution siblings (not inside tasks)
      for (const proofNode of proofNodes) {
        const converted = convertDirective(proofNode as ContainerDirective, ctx);
        if (converted) result.push(converted);
      }
    } else {
      // No tasks found: fall back to statement/direct content logic
      // (will be handled in next rule)
      handleContentWithoutTasks(result, spec, children, ctx, convertBlock, convertDirective);
    }
  } else {
    // No nested task support: handle normally
    handleContentWithoutTasks(result, spec, children, ctx, convertBlock, convertDirective);
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
  convertBlock: (child: BlockContent | DefinitionContent, ctx: VisitContext) => Element | null,
  convertDirective: (node: ContainerDirective, ctx: VisitContext) => Element | null,
): void {
  // Rule 2A: Apply requiresStatement rule
  if (spec.requiresStatement) {
    // Separate body content from proof/solution siblings
    const bodyContent: Array<BlockContent | DefinitionContent> = [];
    const siblings: Element[] = [];

    for (const child of children) {
      if (
        child.type === 'containerDirective' &&
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
          .filter((n): n is Element => n !== null)
      );
      if (statementChildren.length > 0) {
        result.push(el('statement', statementChildren));
      }
    }

    // Append proof/solution siblings (not inside statement)
    result.push(...siblings);
  } else {
    // Rule 2B: No statement wrapping: convert all children directly
    const converted = nestListsInParagraphs(
      children
        .map((child) => convertBlock(child, ctx))
        .filter((n): n is Element => n !== null)
    );
    result.push(...converted);
  }
}
