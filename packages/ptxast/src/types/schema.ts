import type { PtxContent, PtxParent, PtxRoot } from './index.js';
import {
  ptxCuratedElementNames,
  ptxSchemaElementChildren,
  ptxUnmodeledSchemaElementNames,
} from './generated.js';
import type {
  GeneratedPtxCuratedElementName,
  GeneratedPtxAttributeForElement,
  GeneratedPtxAttributeName,
  GeneratedPtxChildElementName,
  GeneratedPtxElementName,
  GeneratedPtxUnmodeledSchemaElementName,
} from './generated.js';

// Keep repo-specific refinements in this file so schema refreshes can overwrite
// generated.ts without clobbering local customizations.

export type PtxSchemaElementName = GeneratedPtxElementName;
export type PtxSchemaAttributeName = GeneratedPtxAttributeName;
export type PtxCuratedElementName = Extract<
  PtxContent['type'],
  GeneratedPtxCuratedElementName
>;
export type PtxUnmodeledSchemaElementName = GeneratedPtxUnmodeledSchemaElementName;

export type PtxSchemaNode<
  ElementName extends PtxCuratedElementName = PtxCuratedElementName,
> = Extract<PtxContent, { type: ElementName }>;

export type PtxSchemaChildElementName<
  ElementName extends PtxSchemaElementName,
> = GeneratedPtxChildElementName<ElementName>;

export type PtxSchemaAttributeForElement<
  ElementName extends PtxSchemaElementName,
> = GeneratedPtxAttributeForElement<ElementName>;

export type PtxSchemaChildNode<
  ElementName extends PtxCuratedElementName,
> = PtxSchemaNode<Extract<PtxSchemaChildElementName<ElementName>, PtxCuratedElementName>>;

export interface PtxSchemaCustomization {
  aliases?: Partial<Record<string, PtxSchemaElementName>>;
  additionalAttributes?: Partial<Record<PtxSchemaElementName, readonly string[]>>;
}

export const ptxSchemaElementNames = Object.freeze(
  Object.keys(ptxSchemaElementChildren),
) as readonly PtxSchemaElementName[];

const ptxSchemaElementNameSet = new Set<string>(ptxSchemaElementNames);
const ptxCuratedElementNameSet = new Set<string>(ptxCuratedElementNames);

function isPtxParent(
  node: PtxRoot | PtxContent,
): node is PtxRoot | (PtxContent & PtxParent) {
  return 'children' in node && Array.isArray(node.children);
}

export function isPtxSchemaElementName(name: string): name is PtxSchemaElementName {
  return ptxSchemaElementNameSet.has(name);
}

export function isPtxCuratedElementName(name: string): name is PtxCuratedElementName {
  return ptxCuratedElementNameSet.has(name);
}

export function getPtxSchemaElementNames(): readonly PtxSchemaElementName[] {
  return ptxSchemaElementNames;
}

export function getPtxCuratedElementNames(): readonly PtxCuratedElementName[] {
  return ptxCuratedElementNames;
}

export function getPtxUnmodeledSchemaElementNames(): readonly PtxUnmodeledSchemaElementName[] {
  return ptxUnmodeledSchemaElementNames;
}

export function getPtxSchemaChildElementNames<
  ElementName extends PtxSchemaElementName,
>(elementName: ElementName): readonly PtxSchemaChildElementName<ElementName>[] {
  return ptxSchemaElementChildren[elementName].elements as readonly PtxSchemaChildElementName<ElementName>[];
}

export function getPtxSchemaAttributeNames<
  ElementName extends PtxSchemaElementName,
>(elementName: ElementName): readonly PtxSchemaAttributeForElement<ElementName>[] {
  return ptxSchemaElementChildren[elementName].attributes as readonly PtxSchemaAttributeForElement<ElementName>[];
}

export function collectPtxSchemaViolations(root: PtxRoot | PtxContent): string[] {
  const violations: string[] = [];

  function visit(node: PtxRoot | PtxContent, nodePath: string): void {
    if (node.type !== 'root' && node.type !== 'text') {
      if (!isPtxSchemaElementName(node.type)) {
        violations.push(`${nodePath}: unknown PreTeXt element <${node.type}>`);
        return;
      }

      const allowedAttributes = new Set<string>(
        getPtxSchemaAttributeNames(node.type) as readonly string[],
      );
      const nodeAttributes = 'attributes' in node ? node.attributes : undefined;
      for (const attributeName of Object.keys(nodeAttributes ?? {})) {
        if (!allowedAttributes.has(attributeName)) {
          violations.push(
            `${nodePath}: attribute "${attributeName}" is not allowed on <${node.type}> according to generated schema data`,
          );
        }
      }
    }

    if (!isPtxParent(node)) {
      return;
    }

    const allowedChildTypes =
      node.type === 'root' || !isPtxSchemaElementName(node.type)
        ? undefined
        : new Set<string>(
            getPtxSchemaChildElementNames(node.type) as readonly string[],
          );

    node.children.forEach((child, index) => {
      const childPath = `${nodePath}/${child.type}[${index}]`;
      if (
        child.type !== 'text' &&
        allowedChildTypes &&
        !allowedChildTypes.has(child.type)
      ) {
        violations.push(
          `${nodePath}: child <${child.type}> is not allowed inside <${node.type}> according to generated schema data`,
        );
      }
      visit(child, childPath);
    });
  }

  visit(root, root.type === 'root' ? 'root' : `<${root.type}>`);
  return violations;
}
