// Projects the division pool (SPEC §4.1) onto the pretext-plus project
// payload (SPEC §4.3) — a direct camelCase mirror of what the Rails app's
// `ProjectsController` permits. Near-identity: the pool already stores
// divisions in pretext-plus's own shape.

import type { ImportedProject, PlusProjectPayload } from '../types';

/**
 * Client-minted UUID for a new Rails record (the same pattern the plus
 * editor uses: Rails inserts the supplied id as the row's primary key).
 * Falls back to a Math.random v4 when `crypto.randomUUID` is unavailable
 * (non-secure contexts); these ids are identifiers, not secrets.
 */
function mintUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Serialize the division pool to a pretext-plus project payload.
 *
 * The host page maps this onto the Rails endpoints (snake_case
 * `divisions_attributes` / `assets_attributes`, multipart for asset bytes);
 * note that `docinfo` currently requires a follow-up PATCH after create —
 * see SPEC §4.3 for the endpoint mapping and known gaps.
 */
export function serializeProjectToPlusPayload(
  project: ImportedProject,
): PlusProjectPayload {
  return {
    title: project.title,
    docinfo: project.docinfo,
    documentType: project.documentKind,
    divisions: project.divisions.map((division) => ({
      id: mintUuid(),
      ref: division.xmlId,
      source: division.content,
      sourceFormat: division.sourceFormat,
      isRoot: division.isRoot,
    })),
    assets: project.assets.map((asset) => ({
      id: mintUuid(),
      ref: asset.ref,
      kind: 'file' as const,
      fileName: asset.fileName,
      data: asset.data,
    })),
  };
}
