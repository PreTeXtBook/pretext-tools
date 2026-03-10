declare module "@unified-latex/unified-latex" {
  type Processor = {
    use: (...args: unknown[]) => Processor;
    processSync: (input: { value: string }) => unknown;
  };

  export function processLatexViaUnified(): Processor;
}

declare module "@unified-latex/unified-latex-to-pretext" {
  export const unifiedLatexToPretext: unknown;
  export const xmlCompilePlugin: unknown;
}
