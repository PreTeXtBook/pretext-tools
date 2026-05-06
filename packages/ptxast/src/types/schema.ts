import type { Root, Element } from 'xast';
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

// Keep repo-specific refinements here so schema refreshes can overwrite
// generated.ts without clobbering local customizations.

export type PtxSchemaElementName = GeneratedPtxElementName;
export type PtxSchemaAttributeName = GeneratedPtxAttributeName;
export type PtxCuratedElementName = Extract<
  GeneratedPtxCuratedElementName,
  string
>;
export type PtxUnmodeledSchemaElementName = GeneratedPtxUnmodeledSchemaElementName;

export type PtxSchemaNode<
  ElementName extends PtxCuratedElementName = PtxCuratedElementName,
> = Element & { name: ElementName };

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

/** Collect schema violations in an xast tree. Checks element names using `node.name`. */
export function collectPtxSchemaViolations(root: Root | Element): string[] {
  const violations: string[] = [];

  function visit(node: Root | Element, nodePath: string): void {
    if (node.type === 'element') {
      const elementName = (node as Element).name;
      if (!isPtxSchemaElementName(elementName)) {
        violations.push(`${nodePath}: unknown PreTeXt element <${elementName}>`);
        return;
      }

      const allowedAttributes = new Set<string>(
        getPtxSchemaAttributeNames(elementName) as readonly string[],
      );
      const nodeAttributes = (node as Element).attributes;
      for (const attributeName of Object.keys(nodeAttributes ?? {})) {
        if (!allowedAttributes.has(attributeName)) {
          violations.push(
            `${nodePath}: attribute "${attributeName}" is not allowed on <${elementName}> according to generated schema data`,
          );
        }
      }
    }

    const children = (node as { children?: unknown[] }).children;
    if (!Array.isArray(children)) return;

    const elementName = node.type === 'element' ? (node as Element).name : undefined;
    const allowedChildTypes =
      !elementName || !isPtxSchemaElementName(elementName)
        ? undefined
        : new Set<string>(
            getPtxSchemaChildElementNames(elementName) as readonly string[],
          );

    children.forEach((child: unknown, index: number) => {
      const c = child as Root | Element | { type: string };
      if (c.type === 'text') return;
      if (c.type !== 'element') return;
      const childEl = c as Element;
      const childPath = `${nodePath}/${childEl.name}[${index}]`;
      if (allowedChildTypes && !allowedChildTypes.has(childEl.name)) {
        violations.push(
          `${nodePath}: child <${childEl.name}> is not allowed inside <${elementName}> according to generated schema data`,
        );
      }
      visit(childEl, childPath);
    });
  }

  visit(root, root.type === 'root' ? 'root' : `<${(root as Element).name}>`);
  return violations;
}
