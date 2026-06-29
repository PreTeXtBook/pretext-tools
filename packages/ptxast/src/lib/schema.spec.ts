import { describe, expect, it } from 'vitest';
import {
  collectPtxSchemaViolations,
  getPtxCuratedElementNames,
  getPtxSchemaAttributeNames,
  getPtxSchemaChildElementNames,
  getPtxUnmodeledSchemaElementNames,
  isPtxCuratedElementName,
  isPtxSchemaElementName,
} from '../index.js';
import { p, section, text, title, xref } from './builders.js';

describe('schema helpers', () => {
  it('recognizes known schema elements', () => {
    expect(isPtxSchemaElementName('p')).toBe(true);
    expect(isPtxSchemaElementName('section')).toBe(true);
    expect(isPtxSchemaElementName('not-a-pretext-node')).toBe(false);
  });

  it('recognizes curated schema elements separately from unmodeled schema elements', () => {
    expect(isPtxCuratedElementName('section')).toBe(true);
    expect(getPtxCuratedElementNames()).toContain('p');
    expect(getPtxUnmodeledSchemaElementNames()).toContain('abstract');
    expect(getPtxUnmodeledSchemaElementNames()).not.toContain('p');
  });

  it('exposes allowed schema children and attributes', () => {
    expect(getPtxSchemaChildElementNames('section')).toContain('title');
    expect(getPtxSchemaAttributeNames('activity')).toContain('xml:id');
  });

  it('reports no violations for a simple valid tree', () => {
    const root = {
      type: 'root' as const,
      children: [section([title([text('Intro')]), p([text('Body')])])],
    };
    expect(collectPtxSchemaViolations(root)).toEqual([]);
  });

  it('reports invalid children and attributes', () => {
    const root = {
      type: 'root' as const,
      children: [
        {
          type: 'element' as const,
          name: 'section',
          attributes: { bogus: '1' },
          children: [xref('sec-target')],
        },
      ],
    };

    expect(collectPtxSchemaViolations(root as any)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('attribute "bogus" is not allowed on <section>'),
        expect.stringContaining('child <xref> is not allowed inside <section>'),
      ]),
    );
  });
});
