// Adapts the record projection (`serialize-records.ts`) to the wire shape
// pretext-plus's `POST /projects/import` expects (SPEC §4.3): a snake_case
// mirror of `ProjectsController#import_params`, with asset bytes base64-encoded
// into a nested `file` object — the whole import travels as one JSON body, no
// multipart round-trip.
//
// This file is the only part of the package that knows pretext-plus's name,
// which is the point: the projection itself is general, and a second hosted
// consumer writes its own adapter beside this one rather than inheriting Rails
// field names it has no use for.

import type {
  ImportedProject,
  PlusAssetAttributes,
  PlusProjectPayload,
  ProjectRecords,
} from "../types";
import { serializeProjectToRecords } from "./serialize-records";

function toPlusAsset(
  asset: ProjectRecords["assets"][number],
): PlusAssetAttributes {
  return {
    ref: asset.ref,
    kind: "file",
    title: asset.fileName,
    short_description: asset.fileName,
    file: {
      filename: asset.fileName,
      content_type: asset.contentType,
      data: asset.data,
    },
  };
}

/** Rename the record projection's fields to the endpoint's own. */
export function recordsToPlusPayload(
  records: ProjectRecords,
): PlusProjectPayload {
  return {
    title: records.title,
    docinfo: records.docinfo,
    document_type: records.documentKind,
    divisions_attributes: records.divisions.map((division) => ({
      ref: division.ref,
      source: division.source,
      source_format: division.sourceFormat,
      is_root: division.isRoot,
    })),
    assets_attributes: records.assets.map(toPlusAsset),
  };
}

/** Serialize the division pool straight to a pretext-plus import payload. */
export function serializeProjectToPlusPayload(
  project: ImportedProject,
): PlusProjectPayload {
  return recordsToPlusPayload(serializeProjectToRecords(project));
}
