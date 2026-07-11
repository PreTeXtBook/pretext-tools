import { describe, expect, it } from 'vitest';
import { buildDivisionPool } from './division-pool';
import { serializeProjectToFiles } from './serialize-files';
import { serializeProjectToPlusPayload } from './serialize-plus';
import type { ImportedProject } from '../types';

const BOOK_SOURCE = `<pretext>
<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>
<book>
<title>Book</title>
<chapter xml:id="intro">
<title>Introduction</title>
<section xml:id="setup"><title>Setup</title><p>s</p></section>
<p>Welcome.</p>
</chapter>
<chapter xml:id="methods"><title>Methods</title><p>m</p></chapter>
</book>
</pretext>`;

describe('serializeProjectToFiles', () => {
  it('writes one file per division with xi:include hierarchy', () => {
    const { project } = buildDivisionPool(BOOK_SOURCE);
    const { files } = serializeProjectToFiles(project);

    expect(Object.keys(files).sort()).toEqual([
      'project.ptx',
      'publication/publication.ptx',
      'source/ch-intro.ptx',
      'source/ch-methods.ptx',
      'source/main.ptx',
    ]);

    const main = files['source/main.ptx'];
    expect(main.startsWith('<?xml')).toBe(true);
    expect(main).toContain('xmlns:xi=');
    expect(main).toContain('<docinfo>');
    expect(main).toContain('<xi:include href="ch-intro.ptx"/>');
    expect(main).toContain('<xi:include href="ch-methods.ptx"/>');
    expect(main).not.toContain('<plus:');
    expect(main).not.toContain('Welcome.');

    expect(files['source/ch-intro.ptx']).toContain('Welcome.');
    expect(files['source/ch-intro.ptx'].startsWith('<?xml')).toBe(true);
    expect(files['project.ptx']).toContain('ptx-version="2"');
  });

  it('nests split sections under a per-chapter directory', () => {
    const { project } = buildDivisionPool(BOOK_SOURCE, {
      splitSections: true,
    });
    const { files } = serializeProjectToFiles(project);

    expect(files['source/ch-intro/sec-setup.ptx']).toContain('<p>s</p>');
    const chapter = files['source/ch-intro.ptx'];
    expect(chapter).toContain('<xi:include href="ch-intro/sec-setup.ptx"/>');
    // A file containing xi:include must declare the namespace itself.
    expect(chapter).toContain('xmlns:xi=');
  });

  it('keeps a plain article main file free of the xi namespace', () => {
    const { project } = buildDivisionPool(
      '<pretext><article><title>A</title><p>x</p></article></pretext>',
    );
    const { files } = serializeProjectToFiles(project);
    expect(files['source/main.ptx']).toContain('<pretext>');
    expect(files['source/main.ptx']).not.toContain('xmlns:xi=');
  });

  it('writes orphan divisions even when nothing references them', () => {
    const project: ImportedProject = {
      title: 'T',
      docinfo: '',
      documentKind: 'book',
      divisions: [
        {
          xmlId: 'document',
          type: 'book',
          title: 'T',
          sourceFormat: 'pretext',
          content: '<book xml:id="document"><title>T</title></book>',
          isRoot: true,
        },
        {
          xmlId: 'loose',
          type: 'chapter',
          title: 'Loose',
          sourceFormat: 'pretext',
          content: '<chapter xml:id="loose"><title>Loose</title></chapter>',
          isRoot: false,
        },
      ],
      assets: [],
    };
    const { files } = serializeProjectToFiles(project, {
      includeScaffold: false,
    });
    expect(Object.keys(files).sort()).toEqual([
      'source/ch-loose.ptx',
      'source/main.ptx',
    ]);
    expect(files['source/main.ptx']).not.toContain('xi:include');
  });
});

describe('serializeProjectToPlusPayload', () => {
  it('maps the pool onto the Rails-permitted shape', () => {
    const { project } = buildDivisionPool(BOOK_SOURCE, {
      assets: { 'img/plot.png': new Uint8Array([7, 7]) },
    });
    const payload = serializeProjectToPlusPayload(project);

    expect(payload.title).toBe('Book');
    expect(payload.documentType).toBe('book');
    expect(payload.docinfo).toContain('<macros>');

    expect(payload.divisions.filter((d) => d.isRoot)).toHaveLength(1);
    const rootRecord = payload.divisions.find((d) => d.isRoot);
    expect(rootRecord?.ref).toBe('document');
    expect(rootRecord?.source).toContain('<plus:chapter ref="intro"/>');
    expect(rootRecord?.sourceFormat).toBe('pretext');

    for (const record of payload.divisions) {
      expect(record.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
    const ids = new Set(payload.divisions.map((d) => d.id));
    expect(ids.size).toBe(payload.divisions.length);

    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0].kind).toBe('file');
    expect(payload.assets[0].ref).toBe('plot');
    expect(payload.assets[0].fileName).toBe('plot.png');
    expect(payload.assets[0].data).toEqual(new Uint8Array([7, 7]));
  });
});
