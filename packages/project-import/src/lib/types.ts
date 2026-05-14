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
