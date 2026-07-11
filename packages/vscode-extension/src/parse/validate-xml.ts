import { SaxesParser } from "saxes";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

/**
 * Attemps to parse `source` as an xml document. Any parse
 * errors are returned as `Diagnostic`s. If the returned array
 * is empty, the parse was successful.
 */
export async function validateXml(source: string): Promise<Diagnostic[]> {
  const ret: Diagnostic[] = [];
  const parser = new SaxesParser({ xmlns: true, position: true });
  try {
    parser.write(source).close();
  } catch (err: unknown) {
    const e = err as Error;
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: parser.line - 1, character: 0 },
        end: { line: parser.line - 1, character: parser.columnIndex },
        //               start: textDocument.positionAt(m.index),
        //             end: textDocument.positionAt(m.index + m[0].length),
      },
      message: e.message,
      //source: "ex",
    };
    ret.push(diagnostic);
  }

  return ret;
}
