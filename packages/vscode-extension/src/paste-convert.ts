/**
 * Paste LaTeX or Markdown into a PreTeXt document and have it arrive converted.
 *
 * SPEC §9.5 (story 1): copying an exercise out of a LaTeX file and converting it
 * afterwards is two moves; this makes it one. Two entry points share all of the
 * work — a `DocumentPasteEditProvider`, so an ordinary paste does it, and an
 * explicit command for a keybinding or when the paste widget is not wanted.
 *
 * Nothing here re-implements conversion: `convertSnippetToPretext` is the same
 * path `cmdConvertText` takes for a selection.
 */
import {
  DocumentDropOrPasteEditKind,
  DocumentPasteEdit,
  Position,
  Range,
  env,
  window,
  workspace,
  type CancellationToken,
  type DataTransfer,
  type DocumentPasteEditContext,
  type DocumentPasteEditProvider,
  type TextDocument,
} from "vscode";
import { pretextOutputChannel } from "./ui";
import { convertSnippetToPretext } from "./commands/convert";
import {
  describeDetection,
  detectConvertibleFormat,
  isInlineContext,
  placeConvertedMarkup,
  type ConvertibleSnippetFormat,
  type PlacementContext,
} from "./paste-convert-core";

/** Language id of PreTeXt XML documents (not the LaTeX/Markdown flavours). */
export const PRETEXT_LANGUAGE_ID = "pretext";

/** The paste-edit kind this provider offers, shown in the paste widget. */
export const PRETEXT_PASTE_KIND =
  DocumentDropOrPasteEditKind.Text.append("pretext");

const FORMAT_LABELS: Record<ConvertibleSnippetFormat, string> = {
  latex: "LaTeX",
  markdown: "Markdown",
};

/** Read the placement context out of the document at `position`. */
export function placementContextAt(
  document: TextDocument,
  position: Position,
): PlacementContext {
  const prefix = document.getText(new Range(new Position(0, 0), position));
  return {
    inline: isInlineContext(prefix),
    baseIndent: document.lineAt(position.line).text.match(/^(\s*)/)?.[1] ?? "",
    midLine: position.character > 0,
  };
}

/** Convert clipboard text and fit it to the insertion point. */
async function convertForPaste(
  text: string,
  format: ConvertibleSnippetFormat,
  document: TextDocument,
  position: Position,
): Promise<string> {
  const converted = await convertSnippetToPretext(text, format);
  const { markup, warning } = placeConvertedMarkup(
    converted,
    placementContextAt(document, position),
  );
  if (warning) {
    pretextOutputChannel.appendLine(warning);
  }
  return markup;
}

/** Whether an ordinary paste should convert, from `pretext-tools.paste.autoConvert`. */
function autoConvertEnabled(): boolean {
  return workspace
    .getConfiguration("pretext-tools")
    .get<boolean>("paste.autoConvert", true);
}

/**
 * Offers converted markup as the result of pasting LaTeX or Markdown into a
 * PreTeXt file.
 *
 * The edit is offered without `yieldTo`, so an ordinary paste converts — which
 * is the point of the feature. VS Code's paste widget still holds plain "Paste"
 * one click away, and `pretext-tools.paste.autoConvert` turns the provider off
 * for anyone who would rather reach for the command instead.
 */
export const pretextPasteEditProvider: DocumentPasteEditProvider = {
  async provideDocumentPasteEdits(
    document: TextDocument,
    ranges: readonly Range[],
    dataTransfer: DataTransfer,
    _context: DocumentPasteEditContext,
    token: CancellationToken,
  ): Promise<DocumentPasteEdit[] | undefined> {
    if (!autoConvertEnabled() || ranges.length === 0) {
      return undefined;
    }
    const item = dataTransfer.get("text/plain");
    if (!item) {
      return undefined;
    }
    const text = await item.asString();
    if (token.isCancellationRequested) {
      return undefined;
    }

    const format = detectConvertibleFormat(text);
    // Logged either way. A paste that quietly stays plain is otherwise
    // indistinguishable from the provider never running at all, and the scores
    // say which snippet fell short and by how much.
    pretextOutputChannel.appendLine(
      `Paste detection: ${describeDetection(text)}`,
    );
    if (!format) {
      return undefined;
    }

    try {
      const insertText = await convertForPaste(
        text,
        format,
        document,
        ranges[0].start,
      );
      if (token.isCancellationRequested) {
        return undefined;
      }
      return [
        new DocumentPasteEdit(
          insertText,
          `Convert ${FORMAT_LABELS[format]} to PreTeXt`,
          PRETEXT_PASTE_KIND,
        ),
      ];
    } catch (error) {
      // Returning nothing leaves VS Code to paste plainly, which is the right
      // fallback — but it must not be silent, or a broken converter looks
      // exactly like text that was never convertible.
      const detail = error instanceof Error ? error.message : String(error);
      pretextOutputChannel.appendLine(
        `Paste conversion failed, pasting unconverted: ${detail}`,
      );
      return undefined;
    }
  },
};

/** Metadata VS Code needs to know when to consult the provider. */
export const pretextPasteProviderMetadata = {
  providedPasteEditKinds: [PRETEXT_PASTE_KIND],
  pasteMimeTypes: ["text/plain"],
};

/**
 * "PreTeXt: Paste and Convert" — the explicit route.
 *
 * Does the conversion unconditionally rather than sniffing the format, so it
 * also covers what the provider deliberately declines: a bare `$x^2$`, a
 * fragment with no sectioning, anything `detectSourceFormat` cannot place.
 */
export async function cmdPasteAndConvert(): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = await env.clipboard.readText();
  if (!text.trim()) {
    window.showInformationMessage("The clipboard is empty.");
    return;
  }

  // Fall back to LaTeX when detection is unsure: it is the format authors
  // reach for here, and its converter passes plain prose through unharmed.
  const format = detectConvertibleFormat(text) ?? "latex";
  const target = editor.selection;

  try {
    const insertText = await convertForPaste(
      text,
      format,
      editor.document,
      target.start,
    );
    await editor.edit((builder) => builder.replace(target, insertText));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pretextOutputChannel.appendLine(`Paste and convert failed: ${detail}`);
    window.showErrorMessage(`Could not convert the pasted text: ${detail}`);
  }
}
