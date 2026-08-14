import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  PRINT_PREVIEW_GLOBAL,
  injectPrintPreview,
  listPrintouts,
  printPreviewBridgeScript,
  rootPrintoutId,
} from "./printout.js";

/**
 * A rendered page reduced to the parts this module keys on: the print-preview
 * buttons the wrapper stylesheet draws on printout headings, carrying the
 * `data-printout*` attributes. Copied in shape from real output — see the
 * round-trip test in renderer.spec.ts, which checks these attributes are what
 * the stylesheets actually emit.
 */
function printLink(
  id: string,
  type: string,
  number: string,
  title: string,
): string {
  return (
    `<div class="print-links"><a class="print-link" ` +
    `style="opacity:0.45;cursor:default;pointer-events:none" ` +
    `aria-disabled="true" title="Print preview" data-printout="${id}" ` +
    `data-printout-type="${type}" data-printout-number="${number}" ` +
    `data-printout-title="${title}"><span class="icon"></span></a></div>`
  );
}

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head>",
  '<script src="https://cdn.example/pretext-core.js"></script>',
  "</head><body>",
  '<section class="worksheet" id="ws-one">',
  `<h2 class="heading">${printLink("ws-one", "Worksheet", "2", "Counting")}</h2>`,
  "</section>",
  '<section class="handout" id="handout-one">',
  `<h2 class="heading">${printLink("handout-one", "Handout", "", "Rings &amp; Fields")}</h2>`,
  "</section>",
  "</body></html>",
].join("\n");

/** A page with no printouts at all. */
const PLAIN_PAGE =
  "<!DOCTYPE html><html><head></head><body><p>Nothing here.</p></body></html>";

/**
 * A stand-in for the `Window` a delivered page runs in. Every reference in the
 * bridge script is through `window`, so an object with the two properties it
 * touches is faithful — and reusing one across two deliveries is exactly the
 * situation an in-place `document.write` rebuild creates: same Window, new
 * document, patch still installed.
 */
function fakeWindow(search: string): Record<string, unknown> {
  // Enough of a document for the light-mode pinning: the classes on <html> and
  // the attributes set there. Starts in dark mode, as an embedder's theme would
  // have left it.
  const classes = new Set<string>(["dark-mode"]);
  const attributes: Record<string, string> = {};
  return {
    URLSearchParams,
    location: { search },
    document: {
      documentElement: {
        classes,
        attributes,
        classList: { remove: (name: string) => classes.delete(name) },
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
      },
    },
  };
}

/** The `<html>` stand-in inside a {@link fakeWindow}. */
function root(window: Record<string, unknown>): {
  classes: Set<string>;
  attributes: Record<string, string>;
} {
  return (
    window.document as {
      documentElement: {
        classes: Set<string>;
        attributes: Record<string, string>;
      };
    }
  ).documentElement;
}

/**
 * Run an injected page's bridge script the way a browser would, then report
 * what pretext-core.js would see: `new URLSearchParams(location.search)`,
 * which is the one and only place it looks for the parameter.
 *
 * Runs the script out of the *page* rather than the generator's return value,
 * so the escaping it went through counts too.
 */
function deliver(html: string, window: Record<string, unknown>): void {
  const block =
    /<!--ptx-print-preview-->([\s\S]*?)<!--\/ptx-print-preview-->/.exec(
      html,
    )?.[1];
  if (!block) {
    throw new Error("no print-preview block in the page");
  }
  // The block also carries a <style> for the print layout; run the script.
  const script = /<script>([\s\S]*?)<\/script>/.exec(block)?.[1];
  if (!script) {
    throw new Error("no print-preview script in the page");
  }
  runInNewContext(script, { window });
}

function printPreviewParam(window: Record<string, unknown>): string | null {
  const Params = window.URLSearchParams as typeof URLSearchParams;
  const { search } = window.location as { search: string };
  return new Params(search).get("printpreview");
}

describe("listPrintouts", () => {
  it("reports each printout once, in document order", () => {
    expect(listPrintouts(PAGE).map((printout) => printout.id)).toEqual([
      "ws-one",
      "handout-one",
    ]);
  });

  it("composes a menu label from type, number and title", () => {
    expect(listPrintouts(PAGE)[0]).toEqual({
      id: "ws-one",
      type: "Worksheet",
      number: "2",
      title: "Counting",
      label: "Worksheet 2: Counting",
    });
  });

  it("drops the parts a printout does not have, and unescapes the rest", () => {
    // No number, and a title that had to be escaped into the attribute.
    expect(listPrintouts(PAGE)[1].label).toBe("Handout: Rings & Fields");
  });

  it("reports nothing for a page without printouts", () => {
    expect(listPrintouts(PLAIN_PAGE)).toEqual([]);
  });
});

describe("rootPrintoutId", () => {
  const printouts = listPrintouts(PAGE);

  it.each(["worksheet", "handout", "project", "activity"])(
    "defaults a document whose root is a <%s> to its own printout",
    (root) => {
      expect(rootPrintoutId(printouts, root)).toBe("ws-one");
    },
  );

  it("leaves a document that merely contains printouts alone", () => {
    // A chapter with three worksheets in it should open as the chapter.
    expect(rootPrintoutId(printouts, "chapter")).toBeUndefined();
    expect(rootPrintoutId(printouts, "pretext")).toBeUndefined();
    expect(rootPrintoutId(printouts, undefined)).toBeUndefined();
  });

  it("has nothing to offer when the page drew no print buttons", () => {
    // A <project> without a @workspace is not a standalone printout.
    expect(rootPrintoutId([], "project")).toBeUndefined();
  });
});

describe("printPreviewBridgeScript", () => {
  it("names the wanted printout, and null when there is none", () => {
    expect(printPreviewBridgeScript("ws-one")).toContain('"ws-one"');
    expect(printPreviewBridgeScript()).toContain("window[KEY] = null");
  });
});

describe("injectPrintPreview", () => {
  it("makes pretext-core.js see the parameter that is not in the URL", () => {
    const window = fakeWindow("?id=1&origin=x");
    deliver(injectPrintPreview(PAGE, "handout-one"), window);
    expect(printPreviewParam(window)).toBe("handout-one");
  });

  it("adds nothing to any other URLSearchParams", () => {
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-one"), window);
    const Params = window.URLSearchParams as typeof URLSearchParams;
    // A different string, an object, no argument at all: all untouched.
    expect(new Params("?a=b").get("printpreview")).toBeNull();
    expect(new Params({ a: "b" }).get("printpreview")).toBeNull();
    expect(new Params().get("printpreview")).toBeNull();
    // And what it hands back is still a real URLSearchParams.
    expect(new Params("?a=b")).toBeInstanceOf(URLSearchParams);
    expect(new Params("?a=b").get("a")).toBe("b");
  });

  it("turns print preview off again, in a window that was left patched", () => {
    // The case a document.write rebuild creates: same Window, new document. The
    // patch installed by the first page is still there, so the second page has
    // to cancel it rather than merely omit its own.
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-one"), window);
    expect(printPreviewParam(window)).toBe("ws-one");
    deliver(injectPrintPreview(PAGE), window);
    expect(printPreviewParam(window)).toBeNull();
    expect(window.__ptxPrintPreviewPatched).toBe(true);
  });

  it("switches printouts on a re-delivery", () => {
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-one"), window);
    deliver(injectPrintPreview(PAGE, "handout-one"), window);
    expect(printPreviewParam(window)).toBe("handout-one");
  });

  it("ignores an id that is not a printout on this page", () => {
    // pretext-core.js swaps in the print stylesheet before it looks the element
    // up, so a stale id — one left over from the previously previewed file —
    // would strand the reader on a print-styled page with no printout on it.
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-from-the-file-i-was-editing"), window);
    expect(printPreviewParam(window)).toBeNull();
  });

  it("replaces its own earlier injection rather than stacking", () => {
    const once = injectPrintPreview(PAGE, "ws-one");
    const twice = injectPrintPreview(once, "handout-one");
    expect(twice.match(/<!--ptx-print-preview-->/g)).toHaveLength(1);
  });

  it("injects into the head, ahead of pretext-core.js", () => {
    const html = injectPrintPreview(PAGE, "ws-one");
    expect(html.indexOf("ptx-print-preview")).toBeLessThan(
      html.indexOf("pretext-core.js"),
    );
  });

  it("leaves a page with no head alone", () => {
    expect(injectPrintPreview("<p>not a page</p>", "ws-one")).toBe(
      "<p>not a page</p>",
    );
  });

  it("pins the print layout to light mode", () => {
    // Paper is light, and print-worksheet.css has no dark palette to speak of
    // — a dark preview would put its black text on the host's dark backdrop.
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-one"), window);
    expect(root(window).classes.has("dark-mode")).toBe(false);
    // Upstream's own switch, honoured by pretext-core.js and by the theme
    // bridge, so neither puts dark mode back while print preview is on.
    expect(root(window).attributes["data-darkmode"]).toBe("disabled");
  });

  it("leaves the theme alone for the ordinary page", () => {
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE), window);
    expect(root(window).classes.has("dark-mode")).toBe(true);
    expect(root(window).attributes["data-darkmode"]).toBeUndefined();
  });

  it("states the paper background only in the print layout", () => {
    // The print stylesheet paints no page background — in a real build the
    // theme underneath it does, and here there is nothing underneath.
    const on = injectPrintPreview(PAGE, "ws-one");
    expect(on).toContain("color-scheme: light");
    expect(on).toContain("background: var(--page-color, #fff) !important");
    expect(injectPrintPreview(PAGE)).not.toContain("color-scheme");
  });

  it("keeps the state on a well-known global, for embedders to read", () => {
    const window = fakeWindow("?id=1");
    deliver(injectPrintPreview(PAGE, "ws-one"), window);
    expect(window[PRINT_PREVIEW_GLOBAL]).toBe("ws-one");
  });
});
