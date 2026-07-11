import { describe, it, expect } from 'vitest';
import { parseTargetsFromManifest } from './project-manifest';

const ROOT = '/home/me/book';

describe('parseTargetsFromManifest', () => {
  it('extracts target names and stamps them with the project root', () => {
    const xml = `
      <project ptx-version="2">
        <targets>
          <target name="web"/>
          <target name="print"/>
        </targets>
      </project>`;
    const targets = parseTargetsFromManifest(xml, ROOT);
    expect(targets.map((t) => t.name)).toEqual(['web', 'print']);
    expect(targets.every((t) => t.path === ROOT)).toBe(true);
  });

  it('treats standalone as true unless absent or explicitly "no"', () => {
    const xml = `
      <project>
        <targets>
          <target name="a" standalone="yes"/>
          <target name="b" standalone="no"/>
          <target name="c"/>
          <target name="d" standalone="whatever"/>
        </targets>
      </project>`;
    const byName = Object.fromEntries(
      parseTargetsFromManifest(xml, ROOT).map((t) => [t.name, t.standalone]),
    );
    expect(byName).toEqual({ a: true, b: false, c: false, d: true });
  });

  it('returns an empty array when there are no targets', () => {
    const xml = `<project><targets></targets></project>`;
    expect(parseTargetsFromManifest(xml, ROOT)).toEqual([]);
  });

  it('returns an empty array (and does not throw) on malformed XML', () => {
    expect(parseTargetsFromManifest('<project><targets>', ROOT)).toEqual([]);
    expect(parseTargetsFromManifest('not xml at all', ROOT)).toEqual([]);
  });
});
