export interface ProjectTemplateOptions {
  mainSource: string; // path to main .ptx, e.g. "source/main.ptx"
  publication: string; // path to publication file
  outputBase?: string;
}

export function renderProjectPtx(options: ProjectTemplateOptions): string {
  const { mainSource, publication, outputBase = 'output' } = options;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project ptx-version="2">
  <targets>
    <target name="web">
      <format>html</format>
      <source>${mainSource}</source>
      <publication>${publication}</publication>
      <output-dir>${outputBase}/web</output-dir>
    </target>
    <target name="print">
      <format>pdf</format>
      <source>${mainSource}</source>
      <publication>${publication}</publication>
      <output-dir>${outputBase}/print</output-dir>
    </target>
  </targets>
</project>
`;
}

export function renderPublicationPtx(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<publication>
  <source>
    <directories external="external" generated="generated"/>
  </source>
  <common>
    <chunking level="1"/>
  </common>
</publication>
`;
}

export function renderXmlProlog(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
`;
}
