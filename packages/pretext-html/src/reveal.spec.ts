import { describe, expect, it } from "vitest";
import {
  injectRevealBridge,
  isRevealView,
  revealBridgeScript,
} from "./reveal.js";
import { detectRenderTarget } from "./target.js";

/** A deck's head, reduced to the parts the injection keys on. */
const DECK_HEAD = [
  "<!DOCTYPE html>",
  "<html><head>",
  '<link href="https://cdn.jsdelivr.net/npm/reveal.js@6/dist/reveal.css" rel="stylesheet">',
  '<script src="https://cdn.jsdelivr.net/npm/reveal.js@6/dist/reveal.js"></script>',
  '<link href="_static/pretext/css/pretext-reveal.css" rel="stylesheet">',
  "</head><body></body>",
  "<script>\nReveal.initialize({\n  controls: true,\n  hash: true\n});\n</script>",
  "</html>",
].join("\n");

describe("isRevealView", () => {
  it.each(["slides", "scroll"])("accepts %s", (view) => {
    expect(isRevealView(view)).toBe(true);
  });
  it.each([["overview"], [""], [null], [undefined], [3]])(
    "rejects %s",
    (value) => {
      expect(isRevealView(value)).toBe(false);
    },
  );
});

describe("revealBridgeScript", () => {
  it("turns on the scroll view", () => {
    expect(revealBridgeScript("scroll")).toContain('"view":"scroll"');
  });

  it("clears the view for the presentation view", () => {
    // Explicitly null rather than absent, so re-injecting over a page that was
    // previously in scroll view actually leaves it.
    expect(revealBridgeScript("slides")).toContain('"view":null');
    expect(revealBridgeScript("slides")).not.toContain('"scroll"');
  });

  it("turns off the presentation-only chrome in scroll view", () => {
    const script = revealBridgeScript("scroll");
    expect(script).toContain('"controls":false');
    expect(script).toContain('"scrollSnap":false');
  });

  it("shows pauses all at once in scroll view, and keeps them for presenting", () => {
    // @pause / <subslide> become reveal fragments, which in scroll view have
    // to be scrolled through one at a time.
    expect(revealBridgeScript("scroll")).toContain('"fragments":false');
    expect(revealBridgeScript("slides")).not.toContain('"fragments"');
  });

  it("removes the fragment class rather than trusting the config", () => {
    // The scroll view counts scroll steps with querySelectorAll('.fragment')
    // and never consults config.fragments, so a paused slide keeps its extra
    // scroll length — and in compact layout reverts to a full-viewport page —
    // unless the class is actually gone.
    const script = revealBridgeScript("scroll");
    expect(script).toContain("querySelectorAll('.reveal .fragment')");
    expect(script).toContain("classList.remove('fragment')");
  });

  it("leaves the fragment class alone when presenting", () => {
    expect(revealBridgeScript("slides")).not.toContain("classList.remove");
  });

  it("strips fragments inside initialize, once the slides exist", () => {
    // The script runs from <head>, where the deck has not been parsed; the
    // deck's own initialize call is at the end of the document, where it has.
    const script = revealBridgeScript("scroll");
    const wrapper = script.indexOf("Reveal.initialize = function");
    const strip = script.indexOf("classList.remove('fragment')");
    const through = script.indexOf("return initialize(merged)");
    expect(wrapper).toBeLessThan(strip);
    expect(strip).toBeLessThan(through);
  });

  it("stacks slides instead of giving each one a full screen", () => {
    expect(revealBridgeScript("scroll")).toContain('"scrollLayout":"compact"');
  });

  it("gives reveal a nominal deck size to scale from, in both views", () => {
    // Without this the deck inherits PreTeXt's width/height of "100%", which
    // resolves to the pane itself — scale 1, and theme text sized for a 960px
    // slide drawn at full size into a much narrower pane.
    for (const view of ["scroll", "slides"] as const) {
      expect(revealBridgeScript(view)).toContain('"width":960');
      expect(revealBridgeScript(view)).toContain('"height":700');
    }
  });

  describe("zoom", () => {
    /** The slide dimensions, read back out of the generated script. */
    function sizeOf(script: string): { width: number; height: number } {
      return {
        width: Number(/"width":(\d+)/.exec(script)?.[1]),
        height: Number(/"height":(\d+)/.exec(script)?.[1]),
      };
    }

    it("defaults to the deck's true presented size", () => {
      expect(sizeOf(revealBridgeScript("scroll"))).toEqual({
        width: 960,
        height: 700,
      });
    });

    it("zooms out by enlarging the slide, not shrinking it", () => {
      // The point of the whole exercise: reveal lays content out in slide
      // units, so only a bigger slide makes fixed-pixel text occupy less of
      // it. Shrinking the box would fit exactly the same content and clip the
      // same overflow, with no way to scroll to what was cut off.
      const half = sizeOf(revealBridgeScript("scroll", { zoom: 0.5 }));
      expect(half).toEqual({ width: 1920, height: 1400 });
    });

    it("keeps the slide's aspect ratio while zooming", () => {
      // Otherwise zooming would reshape the slide, and content would reflow
      // into a box the presented deck will never have.
      const { width, height } = sizeOf(
        revealBridgeScript("scroll", { zoom: 0.4 }),
      );
      expect(width / height).toBeCloseTo(960 / 700, 3);
    });

    it("clamps out-of-range zoom", () => {
      // 0 or negative would divide the slide size into nonsense; above 1 would
      // mean a slide smaller than the deck really is, clipping even sooner.
      expect(sizeOf(revealBridgeScript("scroll", { zoom: 0 })).width).toBe(
        960 / 0.25,
      );
      expect(sizeOf(revealBridgeScript("scroll", { zoom: 5 })).width).toBe(960);
    });

    it("leaves a gutter so slide outlines are not flush with the pane", () => {
      expect(revealBridgeScript("scroll")).toContain('"margin":0.04');
    });

    it("does not zoom the presentation view", () => {
      // Presenting means showing the deck as the audience will see it.
      expect(revealBridgeScript("slides", { zoom: 0.5 })).toContain(
        '"width":960',
      );
    });
  });

  it("suppresses the URL hash, which a webview origin cannot write", () => {
    expect(revealBridgeScript("scroll")).toContain('"hash":false');
    expect(revealBridgeScript("slides")).toContain('"hash":false');
  });

  it("does nothing when reveal.js failed to load", () => {
    expect(revealBridgeScript("scroll")).toContain(
      "typeof Reveal === 'undefined'",
    );
  });
});

describe("injectRevealBridge", () => {
  it("injects after reveal's own script tag, before the deck's initialize", () => {
    const html = injectRevealBridge(DECK_HEAD, "scroll");
    const revealSrc = html.indexOf('src="https://cdn.jsdelivr.net');
    const bridge = html.indexOf("__ptxViewWrapped");
    const initialize = html.indexOf("Reveal.initialize({");
    expect(revealSrc).toBeLessThan(bridge);
    // Classic scripts run in order, so wrapping only works if the bridge
    // precedes the deck's own call.
    expect(bridge).toBeLessThan(initialize);
  });

  it("leaves the deck's own config literal untouched", () => {
    const html = injectRevealBridge(DECK_HEAD, "scroll");
    expect(html).toContain(
      "Reveal.initialize({\n  controls: true,\n  hash: true\n});",
    );
  });

  it("returns a page with no reveal.js unchanged", () => {
    const page = "<html><head></head><body>not a deck</body></html>";
    expect(injectRevealBridge(page, "scroll")).toBe(page);
  });

  it("outlines slides so it is clear where each one ends", () => {
    const html = injectRevealBridge(DECK_HEAD, "scroll");
    expect(html).toContain(
      ".reveal-viewport.reveal-scroll .scroll-page section",
    );
    // Divided back out by the scale, so the line stays hairline-thin however
    // far the deck is zoomed out.
    expect(html).toContain("calc(1px / var(--slide-scale, 1))");
  });

  it("draws the outline inside the slide, where it cannot be clipped", () => {
    // An `outline` loses its top and bottom edges: the slide sits flush inside
    // `.scroll-page-content`, which is overflow:hidden, so anything painted
    // outside the border box is clipped and only the left/right edges show.
    // A `border` would be painted inside but would resize a slide whose
    // dimensions reveal controls.
    const html = injectRevealBridge(DECK_HEAD, "scroll");
    expect(html).toContain("box-shadow: inset");
    expect(html).not.toMatch(/^\s*outline:/m);
    expect(html).not.toMatch(/^\s*border:/m);
  });

  it("replaces a previous injection rather than stacking another", () => {
    // renderHtml already injected once, so an embedder toggling views is
    // always re-injecting over an injected page.
    const once = injectRevealBridge(DECK_HEAD, "scroll");
    const twice = injectRevealBridge(once, "slides");
    expect(twice).toContain('"view":null');
    expect(twice).not.toContain('"view":"scroll"');
    // One block, one style, one script — no accumulation across toggles.
    expect(twice.match(/<!--ptx-reveal-view-->/g)).toHaveLength(1);
    expect(twice.match(/<style>/g)).toHaveLength(1);
  });

  it("survives many toggles without growing", () => {
    let html = injectRevealBridge(DECK_HEAD, "scroll");
    const afterFirst = html.length;
    for (let i = 0; i < 5; i++) {
      html = injectRevealBridge(html, "scroll");
    }
    expect(html.length).toBe(afterFirst);
  });
});

describe("detectRenderTarget", () => {
  it("routes a slideshow to the reveal.js conversion", () => {
    expect(
      detectRenderTarget(
        `<pretext><slideshow><title>D</title></slideshow></pretext>`,
      ),
    ).toBe("slides");
  });

  it("routes an ordinary document to the HTML conversion", () => {
    expect(
      detectRenderTarget(
        `<pretext><article><title>A</title></article></pretext>`,
      ),
    ).toBe("html");
  });

  it("recognises a bare slide fragment", () => {
    expect(
      detectRenderTarget(`<slide xml:id="s"><title>S</title></slide>`),
    ).toBe("slides");
  });

  it("recognises a section of slides", () => {
    expect(
      detectRenderTarget(`<section><title>S</title><slide/></section>`),
    ).toBe("slides");
  });

  it("is not fooled by a commented-out slideshow", () => {
    expect(
      detectRenderTarget(
        `<pretext><!-- <slideshow/> --><article><p>Real.</p></article></pretext>`,
      ),
    ).toBe("html");
  });

  it("is not fooled by a slideshow named in prose", () => {
    // A book *about* PreTeXt discussing the markup, inside CDATA.
    expect(
      detectRenderTarget(
        `<pretext><book><pre><![CDATA[<slideshow/>]]></pre></book></pretext>`,
      ),
    ).toBe("html");
  });

  it("does not mistake an element merely starting with 'slide'", () => {
    expect(
      detectRenderTarget(
        `<pretext><article><slideshowish/></article></pretext>`,
      ),
    ).toBe("html");
  });
});
