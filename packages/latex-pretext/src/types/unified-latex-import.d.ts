declare module "@unified-latex/unified-latex" {
  export type UnifiedProcessor = {
    use: (...args: unknown[]) => UnifiedProcessor;
    processSync: (input: { value: string }) => unknown;
  };

  export function processLatexViaUnified(): UnifiedProcessor;
}
