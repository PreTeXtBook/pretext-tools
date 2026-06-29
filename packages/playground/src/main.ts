import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import { remarkPretext } from "@pretextbook/remark-pretext";
import { toXml } from "xast-util-to-xml";
import { fromXml } from "xast-util-from-xml";
import { ptxastToMarkdown } from "@pretextbook/ptxast-util-to-mdast";
import type { Root as MdastRoot } from "mdast";
import type { PtxRoot } from "@pretextbook/ptxast";

// ─── Sample inputs ───────────────────────────────────────────────────────────

const SAMPLE_MARKDOWN = `## Pythagorean Theorem

A paragraph with *emphasis*, \`inline code\`, and $inline math$.

$$
a^2 + b^2 = c^2
$$

::::theorem[Pythagorean Theorem]{#thm-pythagoras}
For a **right triangle** with legs $a$, $b$ and hypotenuse $c$:

$$
a^2 + b^2 = c^2
$$

:::proof
Let $ABC$ be a right triangle. The result follows.
:::
::::

:::definition[Prime Number]{#def-prime}
An integer $p > 1$ is **prime** if its only positive divisors are $1$ and $p$.
:::

### A Subsection

- First item
- Second item with $x^2$
- Third item

1. Alpha
2. Beta
3. Gamma
`.trim();

const SAMPLE_PRETEXT_XML = `<section xml:id="sec-pythagoras">
  <title>Pythagorean Theorem</title>
  <p>A paragraph with <em>emphasis</em> and <m>x^2</m>.</p>
  <theorem xml:id="thm-pythagoras">
    <title>Pythagorean Theorem</title>
    <statement>
      <p>For a right triangle with legs <m>a</m>, <m>b</m>
      and hypotenuse <m>c</m>: <me>a^2 + b^2 = c^2</me></p>
    </statement>
  </theorem>
</section>`.trim();

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "xml" | "ptxast" | "mdast" | "markdown-out";
type Format = "markdown" | "pretext-xml";

interface ConversionResult {
  xml?: string;
  ptxast?: PtxRoot;
  mdast?: MdastRoot;
  markdownOut?: string;
  error?: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let activeTab: Tab = "xml";
let activeFormat: Format = "markdown";
let lastResult: ConversionResult = {};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const formatSelect = document.getElementById(
  "format-select",
) as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const inputTitle = document.getElementById("input-title") as HTMLSpanElement;
const workspace = document.getElementById("workspace") as HTMLDivElement;
const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");

// ─── Conversion pipelines ─────────────────────────────────────────────────────

function convertMarkdown(md: string): ConversionResult {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);
  const mdast = processor.parse(md) as MdastRoot;
  const ptxast = processor.runSync(mdast, { value: md }) as PtxRoot;
  const xml = toXml(ptxast.children);
  const markdownOut = ptxastToMarkdown(ptxast);
  return { xml, ptxast, mdast, markdownOut };
}

function convertPretextXml(xml: string): ConversionResult {
  const ptxast = fromXml(xml);
  const rexml = toXml(ptxast.children);
  const markdownOut = ptxastToMarkdown(ptxast);
  return { xml: rexml, ptxast, markdownOut };
}

// ─── Run & render ─────────────────────────────────────────────────────────────

function runConversion() {
  setStatus("working");
  try {
    lastResult =
      activeFormat === "markdown"
        ? convertMarkdown(inputEl.value)
        : convertPretextXml(inputEl.value);
    setStatus("ok");
  } catch (e) {
    lastResult = {
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
    setStatus("error");
  }
  renderOutput();
}

function renderOutput() {
  const mdastTab =
    document.querySelector<HTMLButtonElement>('[data-tab="mdast"]')!;
  mdastTab.disabled = activeFormat !== "markdown";
  if (activeFormat !== "markdown" && activeTab === "mdast")
    setTab("xml", false);

  if (lastResult.error) {
    outputEl.textContent = lastResult.error;
    outputEl.className = "output-content error";
    return;
  }

  outputEl.className = "output-content";
  switch (activeTab) {
    case "xml":
      outputEl.textContent = lastResult.xml
        ? indentXml(lastResult.xml)
        : "(no output)";
      break;
    case "ptxast":
      outputEl.textContent = lastResult.ptxast
        ? JSON.stringify(stripForDisplay(lastResult.ptxast), null, 2)
        : "(no output)";
      break;
    case "mdast":
      outputEl.textContent = lastResult.mdast
        ? JSON.stringify(stripForDisplay(lastResult.mdast), null, 2)
        : "(not available for this input format)";
      break;
    case "markdown-out":
      outputEl.textContent = lastResult.markdownOut ?? "(no output)";
      break;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Remove `position` and `data` fields from AST nodes for clean display. */
function stripForDisplay(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripForDisplay);
  if (node !== null && typeof node === "object") {
    const { position: _p, data: _d, ...rest } = node as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [k, stripForDisplay(v)]),
    );
  }
  return node;
}

/** Simple XML pretty-printer: indent on tag boundaries. */
function indentXml(xml: string): string {
  let depth = 0;
  const lines: string[] = [];
  // Split at tag boundaries, preserving text nodes
  const parts = xml.replace(/>\s*</g, ">\n<").split("\n");
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("</")) depth = Math.max(0, depth - 1);
    lines.push("  ".repeat(depth) + part);
    if (
      part.startsWith("<") &&
      !part.startsWith("</") &&
      !part.startsWith("<?") &&
      !part.endsWith("/>") &&
      !/<[^/][^>]*>.*<\/[^>]+>$/.test(part) // skip single-line open+close
    ) {
      depth++;
    }
  }
  return lines.join("\n");
}

function setStatus(s: "ok" | "error" | "working") {
  statusEl.className = `status ${s}`;
  statusEl.textContent = s === "ok" ? "✓ ok" : s === "error" ? "✗ error" : "…";
}

function setTab(tab: Tab, rerender = true) {
  activeTab = tab;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  if (rerender) renderOutput();
}

function setFormat(format: Format) {
  activeFormat = format;
  inputTitle.textContent = format === "markdown" ? "Markdown" : "PreTeXt XML";
  inputEl.value = format === "markdown" ? SAMPLE_MARKDOWN : SAMPLE_PRETEXT_XML;
  runConversion();
}

// ─── Draggable divider ────────────────────────────────────────────────────────

function initDivider() {
  const divider = document.getElementById("divider")!;
  let dragging = false;

  divider.addEventListener("mousedown", (e) => {
    dragging = true;
    divider.classList.add("dragging");
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(80, Math.max(20, pct));
    workspace.style.setProperty("--split", `${clamped}%`);
  });
  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      divider.classList.remove("dragging");
    }
  });
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

inputEl.addEventListener("input", debounce(runConversion, 300));

formatSelect.addEventListener("change", () =>
  setFormat(formatSelect.value as Format),
);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab as Tab));
});

// Intercept Tab key in textarea to insert spaces instead of focus-shift
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    inputEl.value =
      inputEl.value.substring(0, s) + "  " + inputEl.value.substring(end);
    inputEl.selectionStart = inputEl.selectionEnd = s + 2;
    runConversion();
  }
});

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(outputEl.textContent ?? "").then(() => {
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

initDivider();
setFormat("markdown");
