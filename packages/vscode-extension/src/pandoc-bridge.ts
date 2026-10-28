import type { Uri } from "vscode";

/**
 * What the import flows ask of pandoc, behind an interface: pandoc is a native
 * binary that the desktop host runs (pandoc.ts implements this), and the
 * browser host has no process to run it in, so it passes nothing and the
 * flows fall back to the formats the import package reads itself.
 */
export interface PandocBridge {
  /** True when pandoc can be run on this host. */
  installed(): boolean;
  /** Convert a file the wizard received as bytes; `fileName` carries the format. */
  convertUpload(fileName: string, bytes: Uint8Array): Promise<string>;
  /** Convert a file the user picked, carrying out any media it holds. */
  convertFile(uri: Uri): Promise<PandocConversion>;
}

export interface PandocConversion {
  pretext: string;
  /** Extracted media, keyed by a path relative to the extraction directory. */
  media: Record<string, Uint8Array>;
}
