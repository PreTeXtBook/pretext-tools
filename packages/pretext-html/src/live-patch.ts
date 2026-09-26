/// <reference lib="dom" />
/**
 * In-place updates for a live preview: bring the page already on screen up to
 * date with a freshly rendered one by touching only what changed.
 *
 * ## Why not just replace the page
 *
 * A rendered page is a complete document with a dozen scripts behind it
 * (MathJax, pretext-core.js, the Runestone bundles). Replacing it — whether by
 * reassigning an iframe/webview's HTML or with `document.open/write/close` —
 * blanks the page, re-runs every script, and has MathJax typeset the whole
 * document again. The page flashes, and a scroll position restored before
 * MathJax settles the layout lands somewhere else. For a preview that updates
 * on every save (or every pause in typing), that is most of what the reader
 * sees.
 *
 * ## What this does instead
 *
 * {@link patchDocument} compares the previous render with the new one — both
 * as pristine parsed documents, never the live page, which scripts have been
 * rewriting since it loaded — and applies the difference to the live page:
 *
 * - Identical subtrees are left alone, so their typeset math, expanded
 *   `<details>`, and Runestone state all survive.
 * - Block containers (`section`, `article`, `div` wrappers with no text of
 *   their own) are recursed into, their children matched up by content.
 * - Blocks whose only change is attributes — overwhelmingly the
 *   auto-generated ids that shift when a sibling is inserted before them —
 *   are updated in place rather than replaced.
 * - Everything else that changed is replaced wholesale, and
 *   {@link typesetPatch} has MathJax typeset just those blocks.
 *
 * Matching live elements to the previous render tolerates what the page's own
 * scripts add (MathJax output, pretext-core.js's copy-button wrapper around
 * code), but not everything: anything it cannot account for, and anything that
 * only works when the page loads from scratch (scripts, Runestone exercises,
 * the LaTeX macro block), makes it decline with `ok: false`. The caller then
 * falls back to replacing the page, which is always correct, just not smooth.
 *
 * ## Shipping it to a page
 *
 * A VS Code webview is a separate JavaScript context, so the embedder cannot
 * call these functions — it has to inject them. {@link livePatchScript}
 * serializes both functions' source text into an inline script. That is why
 * each is written to be **self-contained**: every helper and constant lives
 * inside the function body, and nothing is imported. Keep it that way; a
 * reference to anything outside the function would be undefined in the page
 * (the spec runs the serialized script in a bare window to catch that).
 */

/** What {@link patchDocument} did, or why it declined. */
export interface LivePatchResult {
  /**
   * True when the live document now shows the new render. False means nothing
   * was changed and the caller must replace the page itself; see `reason`.
   */
  ok: boolean;
  /** Why the patch was declined, when `ok` is false. */
  reason?: string;
  /** Elements newly inserted into the live page (replacements included). */
  added: Element[];
  /** Live elements taken out of the page (replaced ones included). */
  removed: Element[];
  /** Number of elements whose attributes were updated in place. */
  attributeUpdates: number;
}

/**
 * Window property the injected script installs the patcher on, as
 * `{ patchDocument, typeset }`.
 */
export const LIVE_PATCH_GLOBAL = "__ptxLivePatch";

/**
 * Update `live` — a page that was rendered from `oldDoc` and has been running
 * since — so that it shows `newDoc`, changing only what differs.
 *
 * `oldDoc` and `newDoc` must be pristine parses of the two renders' HTML (for
 * instance from `DOMParser`); neither is modified. Nothing in `live` is touched
 * unless the whole update can be applied, so on `ok: false` the page is
 * exactly as it was.
 */
export function patchDocument(
  live: Document,
  oldDoc: Document,
  newDoc: Document,
): LivePatchResult {
  // Everything this function uses is defined inside it; see the module docs.

  /**
   * Elements that only work when the page loads from scratch. Replacing,
   * inserting or removing one — or changing attributes inside one — declines
   * the patch. Scripts would not run when inserted; Runestone turns its inert
   * markup into exercises once, on load; and MathJax reads the macro block
   * once at startup, so already-typeset math would keep the old definitions.
   */
  const UNPATCHABLE =
    "script, #latex-macros, [data-component], .ptx-runestone-container";
  /**
   * Tags whose children are blocks rather than running text. Only these are
   * recursed into (when they have no text of their own), because a patch
   * works on element children and ignores the whitespace between them —
   * harmless between blocks, but not between inline elements, where a space
   * is part of the text.
   */
  const CONTAINER_TAGS = new Set([
    "BODY",
    "MAIN",
    "DIV",
    "SECTION",
    "ARTICLE",
    "ASIDE",
    "NAV",
    "HEADER",
    "FOOTER",
    "DETAILS",
    "FIGURE",
    "UL",
    "OL",
    "LI",
    "DL",
    "BLOCKQUOTE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
  ]);
  /**
   * Inline elements. A `div` or `li` whose children include one of these is
   * treated as running text even when it has no text of its own: the spaces
   * between `<em>a</em> <b>b</b>` are part of the text. (Sections and the
   * like are block containers whatever they hold.)
   */
  const INLINE_TAGS = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "BR",
    "BUTTON",
    "CITE",
    "CODE",
    "DATA",
    "DEL",
    "DFN",
    "EM",
    "I",
    "IMG",
    "INPUT",
    "INS",
    "KBD",
    "LABEL",
    "MARK",
    "Q",
    "S",
    "SAMP",
    "SELECT",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "SVG",
    "TEXTAREA",
    "TIME",
    "U",
    "VAR",
    "WBR",
  ]);
  /**
   * Classes of wrappers the page's scripts put around an original element.
   * pretext-core.js moves each `.clipboardable` code block into a new
   * `div.clipboardable` beside a copy button (and takes the class off the
   * block itself), so the block is found one level down.
   */
  const WRAPPER_CLASSES = ["clipboardable"];
  /** Largest sequence-matching table (old × new children) worth building. */
  const LCS_CELL_LIMIT = 250000;
  const TEXT_NODE = 3;

  interface Bail {
    bail: string;
  }
  interface Located {
    /** The live counterpart of an element of the previous render. */
    inner: Element;
    /** What sits in the live parent's child list: `inner`, or its wrapper. */
    outer: Element;
  }
  interface AttrOp {
    live: Element;
    old: Element;
    next: Element;
  }
  interface Item {
    /** The new render's element this position should show. */
    next: Element;
    /** Live node of the matched previous element; absent for an insertion. */
    outer?: Element;
    /** Replace `outer` with a copy of `next`. */
    replace?: boolean;
    /** `outer` is a container whose own children are patched. */
    sub?: ChildrenPlan;
  }
  interface ChildrenPlan {
    live: Element;
    /** Live node of the first previous child: the anchor for a leading insertion. */
    first: Element | null;
    items: Item[];
    /** Live nodes of previous children with no counterpart in the new render. */
    removed: Element[];
  }

  const attrOps: AttrOp[] = [];
  const keyCache = new Map<Element, string>();

  function bail(reason: string): Bail {
    return { bail: reason };
  }

  function isBail(value: unknown): value is Bail {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Bail).bail === "string"
    );
  }

  function touchesUnpatchable(el: Element): boolean {
    return el.matches(UNPATCHABLE) || el.querySelector(UNPATCHABLE) !== null;
  }

  /**
   * The inline lunr search index, which holds the document's text and so
   * changes with every edit. It is only read once, on load, so there is
   * nothing to gain from patching it: the search box keeps searching the text
   * of the last full load, which is fine for a preview.
   */
  function isSearchIndex(el: Element): boolean {
    return (
      el.tagName === "SCRIPT" &&
      !el.hasAttribute("src") &&
      (el.textContent ?? "").indexOf("ptx_lunr_docs") !== -1
    );
  }

  function isContainer(el: Element): boolean {
    if (
      !CONTAINER_TAGS.has(el.tagName) ||
      el.matches(".process-math") ||
      // Never looked inside: a change anywhere in one is a change to it.
      el.matches(UNPATCHABLE)
    ) {
      return false;
    }
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === TEXT_NODE && /\S/.test(node.nodeValue ?? "")) {
        return false;
      }
    }
    if (el.tagName === "DIV" || el.tagName === "LI") {
      for (const child of Array.from(el.children)) {
        // Upper-cased because foreign elements (svg) keep their own case.
        if (INLINE_TAGS.has(child.tagName.toUpperCase())) {
          return false;
        }
      }
    }
    return true;
  }

  function isWrapperClass(name: string): boolean {
    return WRAPPER_CLASSES.indexOf(name) !== -1;
  }

  /**
   * Whether a live element can be the counterpart of `old`: same tag, same id
   * when `old` has one, and still carrying its first class. Scripts add
   * classes and ids freely (pretext-core.js ids bare paragraphs on load), so
   * only what the render put there is required.
   */
  function sameShape(candidate: Element, old: Element): boolean {
    if (candidate.tagName !== old.tagName) {
      return false;
    }
    const id = old.getAttribute("id");
    if (id !== null && candidate.getAttribute("id") !== id) {
      return false;
    }
    for (const name of Array.from(old.classList)) {
      if (!isWrapperClass(name)) {
        return candidate.classList.contains(name);
      }
    }
    return true;
  }

  /**
   * Find the live counterparts of `oldKids`, in order, among `liveParent`'s
   * children, skipping whatever the page's scripts inserted between them.
   * Null when one cannot be found — the live page is not what the previous
   * render plus the known script behaviour would predict.
   */
  function locate(liveParent: Element, oldKids: Element[]): Located[] | null {
    const liveKids = Array.from(liveParent.children);
    const found: Located[] = [];
    let j = 0;
    for (const old of oldKids) {
      let hit: Located | null = null;
      while (!hit && j < liveKids.length) {
        const candidate = liveKids[j++];
        if (sameShape(candidate, old)) {
          hit = { inner: candidate, outer: candidate };
        } else if (
          candidate.tagName === "DIV" &&
          WRAPPER_CLASSES.some((name) => candidate.classList.contains(name)) &&
          candidate.firstElementChild &&
          sameShape(candidate.firstElementChild, old)
        ) {
          hit = { inner: candidate.firstElementChild, outer: candidate };
        }
      }
      if (!hit) {
        return null;
      }
      found.push(hit);
    }
    return found;
  }

  function sameAttributes(a: Element, b: Element): boolean {
    if (a.attributes.length !== b.attributes.length) {
      return false;
    }
    for (const attr of Array.from(a.attributes)) {
      if (b.getAttributeNS(attr.namespaceURI, attr.localName) !== attr.value) {
        return false;
      }
    }
    return true;
  }

  /** The markup with every attribute dropped: structure and text only. */
  function looseKey(el: Element): string {
    return el.outerHTML.replace(/<([A-Za-z][^\s/>]*)\s[^>]*>/g, "<$1>");
  }

  /**
   * What sequence matching compares: structure and text, and not the numbers
   * PreTeXt prints in headings and captions either. Inserting a theorem
   * renumbers every later one; this still recognizes each of them, so only
   * its heading is replaced rather than the whole block.
   */
  function matchKey(el: Element): string {
    let key = keyCache.get(el);
    if (key === undefined) {
      key = el.outerHTML
        .replace(/<span class="codenumber">[^<]*<\/span>/g, "")
        .replace(/<([A-Za-z][^\s/>]*)\s[^>]*>/g, "<$1>");
      keyCache.set(el, key);
    }
    return key;
  }

  /** Longest common subsequence of old[start..endOld) and next[start..endNew) by matchKey. */
  function commonSubsequence(
    oldKids: Element[],
    newKids: Element[],
    start: number,
    endOld: number,
    endNew: number,
  ): Array<[number, number]> {
    const ids = new Map<string, number>();
    const intern = (el: Element): number => {
      const key = matchKey(el);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      return id;
    };
    const a = oldKids.slice(start, endOld).map(intern);
    const b = newKids.slice(start, endNew).map(intern);
    const n = a.length;
    const m = b.length;
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let k = m - 1; k >= 0; k--) {
        table[i * w + k] =
          a[i] === b[k]
            ? table[(i + 1) * w + k + 1] + 1
            : Math.max(table[(i + 1) * w + k], table[i * w + k + 1]);
      }
    }
    const pairs: Array<[number, number]> = [];
    let i = 0;
    let k = 0;
    while (i < n && k < m) {
      if (a[i] === b[k]) {
        pairs.push([start + i, start + k]);
        i++;
        k++;
      } else if (table[(i + 1) * w + k] >= table[i * w + k + 1]) {
        i++;
      } else {
        k++;
      }
    }
    return pairs;
  }

  /**
   * For each new child, the index of the previous child it continues, or -1
   * for an insertion. Matches are increasing, so no live node has to move.
   *
   * Unchanged runs at either end are matched first (cheap, and usually all
   * but one element); what is left is matched by content, and whatever still
   * has no partner is paired by position with a same-tag neighbour — that is
   * the block being edited.
   */
  function matchChildren(oldKids: Element[], newKids: Element[]): number[] {
    const match: number[] = newKids.map(() => -1);
    let start = 0;
    while (
      start < oldKids.length &&
      start < newKids.length &&
      oldKids[start].isEqualNode(newKids[start])
    ) {
      match[start] = start;
      start++;
    }
    let endOld = oldKids.length;
    let endNew = newKids.length;
    while (
      endOld > start &&
      endNew > start &&
      oldKids[endOld - 1].isEqualNode(newKids[endNew - 1])
    ) {
      endOld--;
      endNew--;
      match[endNew] = endOld;
    }
    const spanOld = endOld - start;
    const spanNew = endNew - start;
    if (spanOld === 0 || spanNew === 0) {
      return match;
    }
    const anchors =
      (spanOld > 1 || spanNew > 1) && spanOld * spanNew <= LCS_CELL_LIMIT
        ? commonSubsequence(oldKids, newKids, start, endOld, endNew)
        : [];
    anchors.push([endOld, endNew]);
    let x = start;
    let y = start;
    for (const [anchorOld, anchorNew] of anchors) {
      while (x < anchorOld && y < anchorNew) {
        if (oldKids[x].tagName === newKids[y].tagName) {
          match[y++] = x++;
          continue;
        }
        let ahead = x + 1;
        while (
          ahead < anchorOld &&
          oldKids[ahead].tagName !== newKids[y].tagName
        ) {
          ahead++;
        }
        if (ahead < anchorOld) {
          x = ahead; // the old children skipped over are removed
        } else {
          y++; // no partner for this one: it is inserted
        }
      }
      if (anchorOld < endOld) {
        match[anchorNew] = anchorOld;
      }
      x = anchorOld + 1;
      y = anchorNew + 1;
    }
    return match;
  }

  function replacement(old: Element, next: Element): Item {
    if (touchesUnpatchable(old) || touchesUnpatchable(next)) {
      throw bail(`<${next.tagName.toLowerCase()}> needs a full page load`);
    }
    return { next, replace: true };
  }

  /**
   * Record the attribute updates that turn `old` into `next` — which differ
   * in attributes only — on their live counterpart `live`. False when some
   * descendant cannot be located in the live page.
   */
  function collectAttributes(
    live: Element,
    old: Element,
    next: Element,
  ): boolean {
    if (!sameAttributes(old, next)) {
      attrOps.push({ live, old, next });
    }
    const oldKids = Array.from(old.children);
    const newKids = Array.from(next.children);
    if (oldKids.length !== newKids.length) {
      return false; // looseKey was fooled (an attribute value holding markup)
    }
    let located: Located[] | null = null;
    for (let i = 0; i < oldKids.length; i++) {
      if (oldKids[i].isEqualNode(newKids[i])) {
        continue;
      }
      located = located ?? locate(live, oldKids);
      if (
        !located ||
        !collectAttributes(located[i].inner, oldKids[i], newKids[i])
      ) {
        return false;
      }
    }
    return true;
  }

  /** Plan the update of one matched pair, whose live node is `at`. */
  function planPair(at: Located, old: Element, next: Element): Item {
    if (old.isEqualNode(next) || (isSearchIndex(old) && isSearchIndex(next))) {
      return { next, outer: at.outer };
    }
    if (old.tagName === next.tagName && isContainer(old) && isContainer(next)) {
      const sub = planChildren(at.inner, old, next);
      if (sub) {
        if (!sameAttributes(old, next)) {
          attrOps.push({ live: at.inner, old, next });
        }
        return { next, outer: at.outer, sub };
      }
    } else if (looseKey(old) === looseKey(next)) {
      const before = attrOps.length;
      if (collectAttributes(at.inner, old, next)) {
        if (touchesUnpatchable(old)) {
          throw bail(
            "attributes changed inside an element that needs a full page load",
          );
        }
        return { next, outer: at.outer };
      }
      attrOps.length = before;
    }
    return { ...replacement(old, next), outer: at.outer };
  }

  /** Plan the update of a container's children; null if the live page cannot be matched. */
  function planChildren(
    live: Element,
    old: Element,
    next: Element,
  ): ChildrenPlan | null {
    const oldKids = Array.from(old.children);
    const newKids = Array.from(next.children);
    const located = locate(live, oldKids);
    if (!located) {
      return null;
    }
    const match = matchChildren(oldKids, newKids);
    const used = oldKids.map(() => false);
    const items: Item[] = [];
    newKids.forEach((child, j) => {
      const i = match[j];
      if (i === -1) {
        if (touchesUnpatchable(child)) {
          throw bail(
            `new <${child.tagName.toLowerCase()}> needs a full page load`,
          );
        }
        items.push({ next: child });
        return;
      }
      used[i] = true;
      items.push(planPair(located[i], oldKids[i], child));
    });
    const removed: Element[] = [];
    oldKids.forEach((child, i) => {
      if (!used[i]) {
        if (touchesUnpatchable(child)) {
          throw bail(
            `removing <${child.tagName.toLowerCase()}> needs a full page load`,
          );
        }
        removed.push(located[i].outer);
      }
    });
    return {
      live,
      first: located.length ? located[0].outer : null,
      items,
      removed,
    };
  }

  /**
   * Compare the heads. They must match except for `<title>` (the division
   * being previewed) and `<meta>` tags (book-level metadata, invisible in a
   * preview, so a changed one is simply left stale). Returns the new title if
   * it changed.
   */
  function planHead(): string | null {
    const oldKids = Array.from(oldDoc.head.children);
    const newKids = Array.from(newDoc.head.children);
    if (oldKids.length !== newKids.length) {
      throw bail("the page head changed");
    }
    let title: string | null = null;
    for (let i = 0; i < oldKids.length; i++) {
      const a = oldKids[i];
      const b = newKids[i];
      if (a.isEqualNode(b)) {
        continue;
      }
      if (a.tagName === "TITLE" && b.tagName === "TITLE") {
        title = b.textContent ?? "";
      } else if (a.tagName !== "META" || b.tagName !== "META") {
        throw bail("the page head changed");
      }
    }
    return title;
  }

  function syncAttributes(op: AttrOp): void {
    const { live: el, old, next } = op;
    for (const attr of Array.from(old.attributes)) {
      if (
        attr.name !== "class" &&
        !next.hasAttributeNS(attr.namespaceURI, attr.localName)
      ) {
        el.removeAttributeNS(attr.namespaceURI, attr.localName);
      }
    }
    for (const attr of Array.from(next.attributes)) {
      if (
        attr.name !== "class" &&
        old.getAttributeNS(attr.namespaceURI, attr.localName) !== attr.value
      ) {
        el.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      }
    }
    // Class by token, so classes the page's scripts added (dark mode, an
    // expanded ToC entry, VS Code's own theme classes) survive.
    const before = Array.from(old.classList);
    const after = Array.from(next.classList);
    for (const name of before) {
      if (after.indexOf(name) === -1) {
        el.classList.remove(name);
      }
    }
    for (const name of after) {
      if (before.indexOf(name) === -1) {
        el.classList.add(name);
      }
    }
  }

  const added: Element[] = [];
  const removed: Element[] = [];

  function apply(plan: ChildrenPlan): void {
    let previous: Element | null = null;
    for (const item of plan.items) {
      if (!item.outer || item.replace) {
        const node = live.importNode(item.next, true);
        if (item.outer) {
          item.outer.replaceWith(node);
          removed.push(item.outer);
        } else if (previous) {
          previous.after(node);
        } else if (plan.first) {
          plan.first.before(node);
        } else {
          plan.live.appendChild(node);
        }
        added.push(node);
        previous = node;
        continue;
      }
      if (item.sub) {
        apply(item.sub);
      }
      previous = item.outer;
    }
    for (const node of plan.removed) {
      node.remove();
      removed.push(node);
    }
  }

  try {
    const title = planHead();
    const html = {
      live: live.documentElement,
      old: oldDoc.documentElement,
      next: newDoc.documentElement,
    };
    if (!sameAttributes(html.old, html.next)) {
      attrOps.push(html);
    }
    if (!live.body || !isContainer(oldDoc.body) || !isContainer(newDoc.body)) {
      throw bail("the page body is not patchable");
    }
    const body = planChildren(live.body, oldDoc.body, newDoc.body);
    if (!body) {
      throw bail("the live page no longer matches the previous render");
    }
    if (!sameAttributes(oldDoc.body, newDoc.body)) {
      attrOps.push({ live: live.body, old: oldDoc.body, next: newDoc.body });
    }

    // Everything is planned, so nothing below can decline: apply it.
    attrOps.forEach(syncAttributes);
    apply(body);
    if (title !== null && live.title !== title) {
      live.title = title;
    }
    return { ok: true, added, removed, attributeUpdates: attrOps.length };
  } catch (error) {
    if (isBail(error)) {
      return {
        ok: false,
        reason: error.bail,
        added: [],
        removed: [],
        attributeUpdates: 0,
      };
    }
    throw error;
  }
}

/**
 * Have the page's MathJax typeset what {@link patchDocument} inserted, and
 * forget what it removed. Resolves once typesetting is done; a no-op when the
 * page has no MathJax (yet — one still starting up typesets the whole page,
 * inserted blocks included, when it gets there).
 *
 * Only `.process-math` elements are typeset, exactly as the page's own
 * startup does: PreTeXt pages are `body.ignore-math`, and typesetting a whole
 * block would also pick up text outside the math spans.
 *
 * Self-contained for the same reason as patchDocument; see the module docs.
 */
export function typesetPatch(
  win: Window,
  result: Pick<LivePatchResult, "added" | "removed">,
): Promise<void> {
  interface MathJaxLike {
    startup?: { promise?: Promise<unknown> };
    typesetPromise?: (elements: Element[]) => Promise<unknown>;
    typesetClear?: (elements: Element[]) => void;
  }
  const mathJax = (win as unknown as { MathJax?: MathJaxLike }).MathJax;
  const startup = mathJax && mathJax.startup;
  if (
    !mathJax ||
    !startup ||
    !startup.promise ||
    typeof mathJax.typesetPromise !== "function"
  ) {
    return Promise.resolve();
  }
  const targets: Element[] = [];
  for (const el of result.added) {
    if (el.matches(".process-math")) {
      targets.push(el);
    } else {
      targets.push(...Array.from(el.querySelectorAll(".process-math")));
    }
  }
  const removed = result.removed;
  if (targets.length === 0 && removed.length === 0) {
    return Promise.resolve();
  }
  // Chained on startup.promise, MathJax's documented way to serialize dynamic
  // typesetting, so two quick patches never typeset concurrently.
  const done = startup.promise
    .then(() => {
      if (removed.length && typeof mathJax.typesetClear === "function") {
        mathJax.typesetClear(removed);
      }
      return targets.length && mathJax.typesetPromise
        ? mathJax.typesetPromise(targets)
        : undefined;
    })
    .then(
      () => undefined,
      (error: unknown) => {
        console.error("pretext-html: typesetting a live patch failed", error);
      },
    );
  startup.promise = done;
  return done;
}

/**
 * The inline `<script>` (as a string) that installs {@link patchDocument} and
 * {@link typesetPatch} on `window[LIVE_PATCH_GLOBAL]` as
 * `{ patchDocument, typeset }`, for embedders whose page runs in a context
 * they cannot call into directly (a VS Code webview). Safe to run again on
 * every in-place rewrite of the page: it just reassigns the property.
 */
export function livePatchScript(): string {
  return [
    "<script>",
    `window[${JSON.stringify(LIVE_PATCH_GLOBAL)}] = {`,
    `  patchDocument: ${patchDocument.toString()},`,
    `  typeset: ${typesetPatch.toString()}`,
    "};",
    "</script>",
  ].join("\n");
}
