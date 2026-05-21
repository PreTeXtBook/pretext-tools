import type { CleaningWarning } from "./clean/warnings";
import type { DocumentKind } from "./layout/document-kind";

export type SourceFormat = "latex" | "markdown" | "pretext";

export interface ConversionContext {
  sourceFormat: SourceFormat;
  detectedSourceFormat: SourceFormat;
}

export interface ConvertedPretextSuccess extends ConversionContext {
  pretextSource: string;
  warnings: CleaningWarning[];
  cleanedNativeSource?: string;
}

export interface ConvertedPretextError extends ConversionContext {
  pretextError: string;
  warnings: CleaningWarning[];
}

export type ConvertedPretextResult =
  | ConvertedPretextSuccess
  | ConvertedPretextError;

export type UploadStatusType = "loading" | "success" | "error";

export type UploadSourceType =
  | "tex"
  | "markdown"
  | "pretext"
  | "zip"
  | "tar.gz";

export interface UploadStatusMessage {
  type: UploadStatusType;
  message: string;
}

export interface ImportedProjectSuccess extends ConversionContext {
  pretextSource: string;
  sourcePath: string;
  sourceName: string;
  sourceType: UploadSourceType;
  documentKind: DocumentKind;
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
  outputFiles: Record<string, string>;
  outputAssets: Record<string, Uint8Array>;
  nativeOutputFiles?: Record<string, string>;
  statusMessages: UploadStatusMessage[];
  warnings: CleaningWarning[];
}

export interface ImportedProjectError {
  pretextError: string;
  statusMessages: UploadStatusMessage[];
  warnings: CleaningWarning[];
}

export type ImportedProjectResult =
  | ImportedProjectSuccess
  | ImportedProjectError;
