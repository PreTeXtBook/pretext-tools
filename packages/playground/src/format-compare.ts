import { formatPretext } from "@pretextbook/format";

// ─── Sample input ─────────────────────────────────────────────────────────────

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext><book xml:id="my-book"><title>My Book</title><frontmatter><titlepage><author><personname>Jane Doe</personname><institution>Some University</institution></author><date>2024</date></titlepage><abstract><p>This is a short abstract with some text that goes on for a while and might need to be wrapped depending on the print width.</p></abstract></frontmatter><chapter xml:id="ch-intro"><title>Introduction</title><p>This is the first paragraph of the introduction. It contains some inline math like <m>x^2 + y^2 = z^2</m> and references.</p><p>A theorem follows.</p><theorem xml:id="thm-example"><title>Example Theorem</title><statement><p>For all <m>n \\geq 1</m>, we have <me>1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}</me>.</p></statement><proof><p>By induction.</p></proof></theorem><section xml:id="sec-code"><title>Code</title><p>Here is a program:</p><listing><caption>Hello World</caption><program language="python"><input>
def hello():
    print("hello world")
</input></program></listing></section></chapter></book></pretext>`.trim();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const outEl = document.getElementById("output") as HTMLPreElement;

const blankLinesEl = document.getElementById("blankLines") as HTMLSelectElement;
const printWidthEl = document.getElementById("printWidth") as HTMLInputElement;
const tabSizeEl = document.getElementById("tabSize") as HTMLInputElement;
const useTabsEl = document.getElementById("useTabs") as HTMLInputElement;
const breakSentencesEl = document.getElementById("breakSentences") as HTMLInputElement;

// ─── Main update loop ─────────────────────────────────────────────────────────

function update(): void {
  const text = inputEl.value;
  const parsedWidth = parseInt(printWidthEl.value, 10);
  const options = {
    breakLines: blankLinesEl.value as "few" | "some" | "many",
    // Don't use || here: 0 is a valid sentinel meaning "no width limit".
    printWidth: Number.isNaN(parsedWidth) ? undefined : parsedWidth,
    tabSize: parseInt(tabSizeEl.value, 10) || 2,
    insertSpaces: !useTabsEl.checked,
    breakSentences: breakSentencesEl.checked,
  };

  try {
    outEl.textContent = formatPretext(text, options);
  } catch (e) {
    outEl.textContent = `Error: ${e}`;
  }
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

const debouncedUpdate = debounce(update, 250);

// ─── Event wiring ─────────────────────────────────────────────────────────────

inputEl.addEventListener("input", debouncedUpdate);
blankLinesEl.addEventListener("change", update);
printWidthEl.addEventListener("input", debouncedUpdate);
tabSizeEl.addEventListener("input", debouncedUpdate);
useTabsEl.addEventListener("change", update);
breakSentencesEl.addEventListener("change", update);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    inputEl.value = inputEl.value.substring(0, s) + "  " + inputEl.value.substring(end);
    inputEl.selectionStart = inputEl.selectionEnd = s + 2;
    debouncedUpdate();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

inputEl.value = SAMPLE;
update();
