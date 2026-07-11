import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { collectBookReferences } from '../book';
import { validateDocument } from '../validate';
import { testGrammar, fixturesDir } from './helpers';

const bookDir = path.join(fixturesDir, 'project-book');
const sourceDir = path.join(bookDir, 'source');
const mainPath = path.join(sourceDir, 'main.ptx');
const mainUri = pathToFileURL(mainPath).toString();
const ch1Path = path.join(sourceDir, 'ch1.ptx');
const ch2Path = path.join(sourceDir, 'ch2.ptx');
const ch2Uri = pathToFileURL(ch2Path).toString();

const realReadFile = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
};

describe('collectBookReferences', () => {
  it('collects ids and labels from every file reachable from the given root documents', () => {
    const refs = collectBookReferences(ch2Uri, realReadFile, [mainPath]);
    expect(refs).toBeDefined();
    expect([...refs!.ids.keys()]).toEqual(
      expect.arrayContaining(['bk', 'ch1', 'target1', 'ch2']),
    );
    expect(refs!.labels.get('diagram1')).toEqual(new Set([ch1Path]));
  });

  it("resolves a relative root document against the validated document's directory", () => {
    // The default root, "main.ptx", sits right next to ch2.ptx.
    const refs = collectBookReferences(ch2Uri, realReadFile);
    expect(refs).toBeDefined();
    expect(refs!.ids.has('target1')).toBe(true);
  });

  it('resolves an already-absolute root document path as-is', () => {
    const refs = collectBookReferences('untitled:doesnt-matter', realReadFile, [
      mainPath,
    ]);
    expect(refs!.ids.has('ch1')).toBe(true);
  });

  it('returns undefined when no root document can be read', () => {
    const readFile = () => undefined;
    const docUri = pathToFileURL(
      path.resolve(fixturesDir, 'solo-fragment.ptx'),
    ).toString();
    expect(collectBookReferences(docUri, readFile)).toBeUndefined();
  });

  it('has no knowledge of project.ptx: an unresolvable relative root just misses', () => {
    // No caller-supplied rootDocuments, and no "main.ptx" next to this file.
    const readFile = () => undefined;
    expect(
      collectBookReferences(mainUri, readFile, ['nope.ptx']),
    ).toBeUndefined();
  });
});

describe('validateDocument with caller-supplied rootDocuments', () => {
  it('resolves an xref target declared in a sibling file via a caller-supplied root', () => {
    const source = fs.readFileSync(ch2Path, 'utf8');
    const result = validateDocument(source, testGrammar(), {
      uri: ch2Uri,
      readFile: realReadFile,
      rootDocuments: [mainPath],
    });
    expect(
      result.diagnostics.filter((d) => d.code === 'dangling-reference'),
    ).toEqual([]);
  });

  it('falls back to a sibling main.ptx when no rootDocuments are supplied', () => {
    const source = fs.readFileSync(ch2Path, 'utf8');
    const result = validateDocument(source, testGrammar(), {
      uri: ch2Uri,
      readFile: realReadFile,
    });
    expect(
      result.diagnostics.filter((d) => d.code === 'dangling-reference'),
    ).toEqual([]);
  });

  it('still reports a genuinely dangling xref', () => {
    const source = `<chapter xml:id="ch2b">
  <title>Chapter Two</title>
  <p>See <xref ref="totally-nonexistent"/> for details.</p>
</chapter>`;
    const result = validateDocument(source, testGrammar(), {
      uri: ch2Uri,
      readFile: realReadFile,
      rootDocuments: [mainPath],
    });
    const diag = result.diagnostics.find(
      (d) => d.code === 'dangling-reference',
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toMatch(/totally-nonexistent/);
  });

  it('flags an xml:id that duplicates one declared in a sibling file', () => {
    // ch1.ptx (a sibling reachable via main.ptx) already declares xml:id="ch1".
    const source = `<chapter xml:id="dup-across-files">
  <title>Chapter Two</title>
  <p xml:id="ch1">Reusing ch1's id by mistake.</p>
</chapter>`;
    const result = validateDocument(source, testGrammar(), {
      uri: ch2Uri,
      readFile: realReadFile,
      rootDocuments: [mainPath],
    });
    const diag = result.diagnostics.find((d) => d.code === 'duplicate-id');
    expect(diag).toBeDefined();
    expect(diag!.message).toMatch(/"ch1"/);
  });

  it('flags a label that duplicates one declared in a sibling file', () => {
    // ch1.ptx already declares label="diagram1" on its <mermaid>.
    const source = `<chapter xml:id="ch2c">
  <title>Chapter Two</title>
  <mermaid label="diagram1">graph TD; X --> Y;</mermaid>
</chapter>`;
    const result = validateDocument(source, testGrammar(), {
      uri: ch2Uri,
      readFile: realReadFile,
      rootDocuments: [mainPath],
    });
    const diag = result.diagnostics.find((d) => d.code === 'duplicate-label');
    expect(diag).toBeDefined();
    expect(diag!.message).toMatch(/"diagram1"/);
  });

  it("does not flag a root document's own ids as book-wide duplicates of itself", () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const result = validateDocument(source, testGrammar(), {
      uri: mainUri,
      readFile: realReadFile,
      rootDocuments: [mainPath],
    });
    expect(result.diagnostics.filter((d) => d.code === 'duplicate-id')).toEqual(
      [],
    );
    expect(
      result.diagnostics.filter((d) => d.code === 'duplicate-label'),
    ).toEqual([]);
  });
});
