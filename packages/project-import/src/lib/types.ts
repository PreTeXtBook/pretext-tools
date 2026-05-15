export type SourceFormat = "latex" | "markdown" | "pretext";

export interface ConversionContext {
  sourceFormat: SourceFormat;
  detectedSourceFormat: SourceFormat;
}

export interface ConvertedPretextSuccess extends ConversionContext {
  pretextSource: string;
}

export interface ConvertedPretextError extends ConversionContext {
  pretextError: string;
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
  files: Record<string, string>;
  statusMessages: UploadStatusMessage[];
}

export interface ImportedProjectError {
  pretextError: string;
  statusMessages: UploadStatusMessage[];
}

export type ImportedProjectResult =
  | ImportedProjectSuccess
  | ImportedProjectError;
