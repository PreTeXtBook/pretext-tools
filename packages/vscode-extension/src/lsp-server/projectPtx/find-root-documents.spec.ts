import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { URI } from 'vscode-uri';
import { findProjectRootDocuments } from './find-root-documents';

// `findProjectRootDocuments` derives its paths from `URI.parse(...).fsPath`,
// which (on Windows) lowercases the drive letter, unlike `path.resolve`. Run
// our own root through the same round-trip so expectations use the identical
// casing convention rather than tripping over a spurious mismatch.
const root = URI.parse(
  pathToFileURL(
    path.resolve(__dirname, '__fixtures__', 'sample-book'),
  ).toString(),
).fsPath;

function uriFor(...segments: string[]): string {
  return pathToFileURL(path.join(root, ...segments)).toString();
}

describe('findProjectRootDocuments', () => {
  it("resolves each target's source attribute, relative to the project source dir", () => {
    const readFile = (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === path.join(root, 'project.ptx').replace(/\\/g, '/')) {
        return `<project ptx-version="2" source="src"><targets><target name="web" format="html" source="book.ptx"/></targets></project>`;
      }
      return undefined;
    };
    const docUri = uriFor('src', 'ch1.ptx');
    const result = findProjectRootDocuments(docUri, readFile);
    expect(result).toEqual([path.join(root, 'src', 'book.ptx')]);
  });

  it('defaults to source/main.ptx when the manifest declares no sources', () => {
    const readFile = (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === path.join(root, 'project.ptx').replace(/\\/g, '/')) {
        return `<project ptx-version="2"><targets><target name="web" format="html"/></targets></project>`;
      }
      return undefined;
    };
    const docUri = uriFor('source', 'ch1.ptx');
    const result = findProjectRootDocuments(docUri, readFile);
    expect(result).toEqual([path.join(root, 'source', 'main.ptx')]);
  });

  it('deduplicates and collects distinct sources across multiple targets', () => {
    const readFile = (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === path.join(root, 'project.ptx').replace(/\\/g, '/')) {
        return `<project ptx-version="2">
          <targets>
            <target name="web" format="html" source="main.ptx"/>
            <target name="print" format="pdf" source="main.ptx"/>
            <target name="alt" format="html" source="alt-main.ptx"/>
          </targets>
        </project>`;
      }
      return undefined;
    };
    const docUri = uriFor('source', 'ch1.ptx');
    const result = findProjectRootDocuments(docUri, readFile);
    expect(new Set(result)).toEqual(
      new Set([
        path.join(root, 'source', 'main.ptx'),
        path.join(root, 'source', 'alt-main.ptx'),
      ]),
    );
  });

  it('walks upward through parent directories to find the manifest', () => {
    const readFile = (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === path.join(root, 'project.ptx').replace(/\\/g, '/')) {
        return `<project ptx-version="2"><targets><target name="web" format="html"/></targets></project>`;
      }
      return undefined;
    };
    const docUri = uriFor('source', 'chapters', 'deep', 'ch1.ptx');
    const result = findProjectRootDocuments(docUri, readFile);
    expect(result).toEqual([path.join(root, 'source', 'main.ptx')]);
  });

  it("resolves a legacy (v1, no ptx-version) manifest's <source> element, relative to the project root", () => {
    const readFile = (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === path.join(root, 'project.ptx').replace(/\\/g, '/')) {
        return `<project>\n  <source>sample-article.xml</source>\n  <output dir="output"/>\n</project>`;
      }
      return undefined;
    };
    const docUri = uriFor('sample-article.xml');
    const result = findProjectRootDocuments(docUri, readFile);
    expect(result).toEqual([path.join(root, 'sample-article.xml')]);
  });

  it('returns undefined when no project.ptx is found', () => {
    const readFile = () => undefined;
    expect(
      findProjectRootDocuments(uriFor('orphan.ptx'), readFile),
    ).toBeUndefined();
  });
});
