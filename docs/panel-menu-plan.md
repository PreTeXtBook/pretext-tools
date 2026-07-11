# PreTeXt Sidebar Panel — Audit & Implementation Plan

Goal: turn the PreTeXt activity-bar sidebar into a useful panel with three views —
**Actions** (clickable commands), **Targets** (build/view each target from
`project.ptx`), and a fixed **Document Outline** — implemented in phases so each
step is small, testable, and shippable on its own.

Decisions already made:

- Three separate views: Actions, Targets, Document Outline.
- Outline work is phased: fix the active-file outline first, add a project-wide
  (xi:include-following) outline later.
- Outline shows divisions always; block-level elements (theorems, figures, …)
  behind a setting, default off.

---

## 1. Primer: how VS Code sidebar panels work

Everything in the sidebar is a combination of **declarative contributions** in
`packages/vscode-extension/package.json` and **imperative providers** registered
in TypeScript at activation time. The relevant contribution points:

| Contribution | What it does |
|---|---|
| `viewsContainers.activitybar` | The icon in the far-left activity bar. Already exists (`pretext-sidebar`). |
| `views.<container-id>` | The collapsible sections inside that container. Each has an `id` and a `name`. Already has one: `pretextDocumentOutline`. |
| `viewsWelcome` | Markdown (with command links!) shown when a view's tree is **empty**. Great for "no project found — [Create one]". |
| `menus."view/title"` | Icon buttons in a view's title bar (e.g. the outline's refresh button). Gated by `"when": "view == <id>"`. |
| `menus."view/item/context"` | Right-click menu items on tree rows; with `"group": "inline"` they render as **hover icon buttons on the row** — this is how the ▶ build button on a target row works. Gated by `view == <id> && viewItem == <contextValue>`. |
| `commands` | Every command a menu/tree references must be declared here (title, icon, category). |

On the TypeScript side, a view is powered by a `TreeDataProvider<T>`:

- `getChildren(element?)` — return top-level items when called with no argument,
  otherwise the element's children.
- `getTreeItem(element)` — convert your data object into a `TreeItem`
  (label, `ThemeIcon`, description, tooltip, `collapsibleState`,
  `command` = what happens on click, `contextValue` = the string that
  `viewItem ==` matches in menus).
- `onDidChangeTreeData` — an `EventEmitter` you fire to make VS Code re-query
  the tree.

Register it with `window.registerTreeDataProvider(viewId, provider)` or
`window.createTreeView(viewId, { treeDataProvider })` — the latter returns a
`TreeView` handle needed for fancier things (`reveal()` for follow-cursor,
badges). The existing outline uses `registerTreeDataProvider`
([extension.ts:180](../packages/vscode-extension/src/extension.ts#L180)).

Codicon names for `ThemeIcon` / `"icon": "$(...)"` are listed at
<https://microsoft.github.io/vscode-codicons/dist/codicon.html>.

---

## 2. Audit of the current state

### What exists

- Activity-bar container `pretext-sidebar` (icon: `logo.png`) with one view,
  `pretextDocumentOutline` ([package.json:38-54](../packages/vscode-extension/package.json#L38-L54)).
- [documentOutline.ts](../packages/vscode-extension/src/documentOutline.ts) —
  the `TreeDataProvider`; listens to active-editor and document-change events.
- [outline-parser.ts](../packages/vscode-extension/src/outline-parser.ts) — a
  pure, regex-based line scanner (unit-tested in `outline-parser.spec.ts`;
  7 tests, all passing — but none cover the bugs below).
- A refresh button on the view title (`pretext-tools.refreshOutline`).
- All the commands the panel should surface already exist and work
  (build/view/generate/deploy/new/import/convert/format/update…), reachable via
  the command palette and the status-bar "PreTeXt" quick-pick.
- Target discovery already exists: `projects` / `ensureProjectList()` in
  [project.ts](../packages/vscode-extension/src/project.ts), fed by the pure
  parser [project-manifest.ts](../packages/vscode-extension/src/project-manifest.ts).

### Outline bugs (confirmed by code reading)

| # | Bug | Where |
|---|-----|-------|
| O1 | Only parses the **active file**; never follows `xi:include`. On a real book's `main.ptx` the outline is nearly empty. | [documentOutline.ts:171-174](../packages/vscode-extension/src/documentOutline.ts#L171-L174) |
| O2 | Outline **blanks out** when focus moves off a text editor (Live Preview webview, output panel, visual editor) — `activeTextEditor` becomes `undefined` and `refresh()` clears roots. | [documentOutline.ts:95-103](../packages/vscode-extension/src/documentOutline.ts#L95-L103) |
| O3 | **Title stealing**: `extractTitle` looks ahead 8 lines unconditionally, so an untitled `<chapter>` followed by `<section><title>X</title>` shows "X" as the chapter's title. | [outline-parser.ts:158-174](../packages/vscode-extension/src/outline-parser.ts#L158-L174) |
| O4 | **Missing division tags**: no `part`, `preface`, `worksheet`, `exercises`, `reading-questions`, `solutions`, `glossary`, `index`, `subexercises`, `acknowledgement`, `dedication`, `colophon`, `biography`. (The file's docstring also promises figures/tables/equations that were never configured.) | [outline-parser.ts:15-27](../packages/vscode-extension/src/outline-parser.ts#L15-L27) |
| O5 | Any line containing `<!--` is skipped **entirely**, even content before the comment (`<section xml:id="x"> <!-- TODO -->` is missed). | [outline-parser.ts:70-79](../packages/vscode-extension/src/outline-parser.ts#L70-L79) |
| O6 | Two closing tags on one line (`</section></chapter>`) are processed in `OUTLINE_TAGS` insertion order, not textual order, corrupting the stack; only the **first** opening tag per line is seen. | [outline-parser.ts:82-103, 147](../packages/vscode-extension/src/outline-parser.ts#L82-L103) |
| O7 | Re-parses the whole document on **every keystroke** — no debounce. | [documentOutline.ts:76-86](../packages/vscode-extension/src/documentOutline.ts#L76-L86) |
| O8 | No empty-state UX: the view is silently blank when no `.ptx` file is open (no `viewsWelcome`). | package.json |

### Side findings (not blocking, worth fixing sometime)

- `pretext-tools.spellCheck` is declared in `package.json` (line ~253) but
  **never registered** in `extension.ts` — invoking it from the palette errors
  with "command not found". Either register it or remove the declaration.
- The activity-bar icon is a color PNG; VS Code's guidelines want a 24×24
  monochrome SVG (it gets masked to match the theme). See Phase 5.
- The only activation event is `workspaceContains:project.ptx` (plus implicit
  activation from commands/views). Opening a lone `.ptx` file in a folder
  without a manifest never activates the extension. Adding `onLanguage:pretext`
  fixes that (Phase 5).
- The LSP registers document symbols **only for `project.ptx`** (targets), so
  the built-in breadcrumbs/Outline stay empty for source files. Optional Phase 5
  item: register a `DocumentSymbolProvider` reusing the fixed outline parser.

---

## 3. Target design

```
PRETEXT  (activity bar icon)
├─ ACTIONS                       ← Phase 2 (new view, static tree)
│    Build last target
│    Build current file (standalone)
│    View output …
│    Generate assets
│    Deploy to GitHub
│    New project / Import project
│    Convert to PreTeXt / Format
│    Update PreTeXt / Walkthrough / Show log
├─ TARGETS                       ← Phase 3 (new view, from project.ptx)
│    web        html    [▶ build] [👁 view]
│    print      pdf     [▶]      [👁]
│    (click a row → open its definition in project.ptx)
└─ DOCUMENT OUTLINE              ← Phase 1 fixes, Phase 4 enhancements
     ▾ Book: My Book
       ▾ Ch 1: Introduction
           Sec 1.1 …
```

Phases are independent; each ends with something you can run (F5) and commit.

---

## 4. Phase 1 — Fix the Document Outline

All parser changes are in `outline-parser.ts` (pure, unit-testable); provider
changes are in `documentOutline.ts`. Roughly a day of careful work.

### 4.1 Rewrite the scan loop (fixes O5, O6)

Replace the per-tag regex loops with: (a) blank out comments up front, and
(b) process every open/close token **in textual order** with a single global
regex. This kills the comment-line skipping, the tag-order corruption, and the
"first tag per line only" limit in one move.

```ts
// Blank comments but keep every character position (offsets/line numbers
// stay valid because non-newline chars become spaces).
export function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

const TAG_NAMES = [...OUTLINE_TAGS].join("|");
// One regex that matches an opening or closing outline tag; the (/?) group
// tells us which. (?=[\s>/]) ensures <section> doesn't match <sectionfoo>.
const TAG_TOKEN = new RegExp(`<(\\/?)(${TAG_NAMES})(?=[\\s>/])`, "g");

export function parseOutline(text: string): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: Array<{ tag: string; node: OutlineItem }> = [];
  const lines = blankComments(text).split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    TAG_TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_TOKEN.exec(line))) {
      const [, slash, tag] = m;

      if (slash) {
        // Closing tag: pop to (and including) the matching open. If there is
        // no matching open on the stack (stray close while the user is
        // mid-edit), leave the stack alone instead of emptying it.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }

      // Opening tag. Only look for xml:id inside THIS tag's own attributes.
      const attrText = line.slice(m.index).match(/^<[^>]*/)?.[0] ?? "";
      const xmlId = attrText.match(/xml:id=["']([^"']+)["']/)?.[1] ?? "";

      const node: OutlineItem = {
        tag,
        title: extractTitle(lines, lineNum),
        xmlId,
        line: lineNum,
        character: m.index,
        children: [],
      };
      (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
      if (CONTAINER_TAGS.has(tag)) {
        stack.push({ tag, node });
      }
    }
  }
  return roots;
}
```

Note the old "self-contained on one line" special-casing disappears entirely:
`<section>…</section>` on one line now just pushes then pops, in order.

### 4.2 Stop the title look-ahead at the next division (fixes O3)

Truncate the 8-line window as soon as a line opens another outline tag:

```ts
const TAG_OPEN = new RegExp(`<(${TAG_NAMES})(?=[\\s>/])`);

export function extractTitle(lines: string[], startLine: number): string {
  let end = Math.min(startLine + 8, lines.length);
  for (let i = startLine + 1; i < end; i++) {
    if (TAG_OPEN.test(lines[i])) {
      end = i;
      break;
    }
  }
  const searchWindow = lines.slice(startLine, end).join("\n");
  // ... rest unchanged (single-line match, then multi-line match)
}
```

(The window still includes `startLine` itself, so
`<section><title>T</title>` on one line keeps working.)

### 4.3 Add the missing divisions (fixes O4)

Extend `ELEMENT_CONFIG` (suggested codicons — change freely):

```ts
part:                { icon: "symbol-namespace", label: "Part" },
preface:             { icon: "note",             label: "Preface" },
acknowledgement:     { icon: "note",             label: "Acknowledgements" },
dedication:          { icon: "heart",            label: "Dedication" },
colophon:            { icon: "note",             label: "Colophon" },
biography:           { icon: "person",           label: "Biography" },
worksheet:           { icon: "checklist",        label: "Worksheet" },
exercises:           { icon: "tasklist",         label: "Exercises" },
"reading-questions": { icon: "question",         label: "Reading Questions" },
solutions:           { icon: "check-all",        label: "Solutions" },
glossary:            { icon: "book",             label: "Glossary" },
subexercises:        { icon: "tasklist",         label: "Subexercises" },
index:               { icon: "list-ordered",     label: "Index" },
```

Add the ones that can contain other outline items to `CONTAINER_TAGS`:
`part`, `preface`, `worksheet`, `exercises`, `subexercises`, `solutions`,
`glossary`, `appendix` is already there — check each against the PreTeXt schema
as you go. Also update the module docstring in `documentOutline.ts` (it
currently promises figures/tables/equations).

### 4.4 Don't blank on focus loss (fixes O2)

In the `PretextDocumentOutlineProvider` constructor, only rebuild when a
PreTeXt editor becomes active; when `activeTextEditor` is `undefined` (focus in
a webview/panel) keep showing the last outline:

```ts
window.onDidChangeActiveTextEditor((editor) => {
  if (editor && isPretextFile(editor.document.fileName)) {
    this.refresh();
  }
  // else: keep the previous outline; do NOT clear it.
}),
```

And in `refresh()`, only replace `this.roots` when there *is* a suitable
editor (leave them untouched otherwise, rather than setting `[]`).

### 4.5 Debounce edits (fixes O7)

```ts
private refreshTimer: ReturnType<typeof setTimeout> | undefined;
// in the onDidChangeTextDocument handler:
clearTimeout(this.refreshTimer);
this.refreshTimer = setTimeout(() => this.refresh(), 300);
```

(Also `clearTimeout` in `dispose()`.)

### 4.6 Welcome content (fixes O8)

In `package.json`:

```json
"viewsWelcome": [
  {
    "view": "pretextDocumentOutline",
    "contents": "Open a PreTeXt (.ptx) file to see its outline."
  }
]
```

`viewsWelcome` shows automatically whenever `getChildren()` returns `[]`.

### 4.7 Tests to add (`outline-parser.spec.ts`)

- Untitled chapter followed by a titled section → chapter title is `""`
  (regression for O3).
- `<part>` appears and contains chapters (O4).
- `<section xml:id="x"> <!-- note -->` is still found; a multi-line comment
  containing `<section>` is still ignored (O5).
- `</section></chapter>` on one line, then a sibling chapter → siblings are
  not nested and the book is still on the stack (O6).
- Two opening tags on one line (`<chapter><section>`) both appear (O6).
- Stray closing tag (`</chapter>` with nothing open) doesn't destroy the tree.

Run with `npx vitest run src/outline-parser.spec.ts` from
`packages/vscode-extension`.

### 4.8 Verify by hand

F5 → open a `.ptx` file → check titles/nesting; click Live Preview and confirm
the outline no longer blanks; type quickly and confirm no flicker.

---

## 5. Phase 2 — Actions view

The simplest new view: a static list where clicking a row runs a command.
Good first exposure to the TreeDataProvider pattern. ~1–2 hours.

### 5.1 `package.json` — declare the view

```json
"views": {
  "pretext-sidebar": [
    { "id": "pretextActions",         "name": "Actions" },
    { "id": "pretextTargets",         "name": "Targets" },
    { "id": "pretextDocumentOutline", "name": "Document Outline" }
  ]
}
```

(Declare `pretextTargets` now too; until Phase 3 registers a provider it will
just show its welcome text — or leave it out until Phase 3 if you prefer.)

### 5.2 New file `src/actionsView.ts`

```ts
import {
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";

interface Action {
  label: string;
  command: string;
  icon: string;       // codicon name
  tooltip?: string;
}

const ACTIONS: Action[] = [
  { label: "Build last target",     command: "pretext-tools.buildLast",   icon: "run",          tooltip: "Build the most recent (or default) target" },
  { label: "Build current file",    command: "pretext-tools.buildFile",   icon: "file-binary",  tooltip: "Build the active file as a standalone document" },
  { label: "View output",           command: "pretext-tools.view",        icon: "open-preview" },
  { label: "Live preview",          command: "pretext-tools.livePreview", icon: "preview" },
  { label: "Generate assets",       command: "pretext-tools.generate",    icon: "symbol-color" },
  { label: "Deploy to GitHub",      command: "pretext-tools.deploy",      icon: "cloud-upload" },
  { label: "New project…",          command: "pretext-tools.new",         icon: "new-folder" },
  { label: "Import project…",       command: "pretext-tools.importProject", icon: "package" },
  { label: "Convert to PreTeXt…",   command: "pretext-tools.convertText", icon: "replace" },
  { label: "Update PreTeXt",        command: "pretext-tools.updatePTX",   icon: "arrow-up" },
  { label: "Getting started",       command: "pretext-tools.gettingStarted", icon: "mortar-board" },
  { label: "Show log",              command: "pretext-tools.showLog",     icon: "output" },
];

export class PretextActionsProvider implements TreeDataProvider<Action> {
  getTreeItem(action: Action): TreeItem {
    const item = new TreeItem(action.label, TreeItemCollapsibleState.None);
    item.iconPath = new ThemeIcon(action.icon);
    item.tooltip = action.tooltip ?? action.label;
    item.command = { command: action.command, title: action.label };
    return item;
  }
  getChildren(action?: Action): Action[] {
    return action ? [] : ACTIONS;
  }
}
```

Optional refinement: include "Format document" only when
`workspace.getConfiguration("pretext-tools").get("experimentalFeatures")` is
true — filter inside `getChildren()`, add an `onDidChangeTreeData` emitter, and
fire it from an `onDidChangeConfiguration` listener.

### 5.3 Register in `extension.ts`

Next to the outline registration:

```ts
import { PretextActionsProvider } from "./actionsView";
// ...
context.subscriptions.push(
  window.registerTreeDataProvider("pretextActions", new PretextActionsProvider()),
);
```

### 5.4 Verify

F5 → PreTeXt icon → Actions view lists the rows with icons; clicking "Build
last target" behaves exactly like the palette command.

---

## 6. Phase 3 — Targets view

One row per target from `project.ptx`, with inline ▶ (build) and 👁 (view)
buttons, a refresh button in the title bar, and welcome content when no
project exists. This phase also does a small refactor so targets can be built
*directly* instead of via quick-pick. Roughly half a day.

### 6.1 Refactor: extract parameterized build/view functions

In [commands/build.ts](../packages/vscode-extension/src/commands/build.ts), the
body of `cmdBuildAny`'s quick-pick callback becomes an exported function; the
quick-pick then calls it:

```ts
export function buildTarget(target: Target, runInTerminal = false) {
  if (runInTerminal) {
    const terminal = utils.setupTerminal(pretextTerminal, target.path);
    terminal.sendText("pretext build " + target.name);
  } else {
    runPretext(cli.cmd(), "build", target.name, target.path);
  }
  updateLastTarget({ name: target.name, path: target.path, standalone: false, filename: "" });
  setTopCommand("Build target: " + target.name);
}
```

`cmdBuildAny` keeps its quick-pick UI but ends with
`buildTarget({ name: qpSelection.label, path: qpSelection.description, ... })`.
Do the same in [commands/view.ts](../packages/vscode-extension/src/commands/view.ts)
for a `viewTarget(target)` extracted from `cmdViewCLI`.

### 6.2 (Optional but nice) capture `format` in the manifest parser

[project-manifest.ts](../packages/vscode-extension/src/project-manifest.ts)
currently keeps only `name`/`standalone`. Add `format` so the row can show
"web — html". project.ptx **v2** manifests put it in an attribute; legacy v1
uses a `<format>` child element — xml2js exposes both:

```ts
format: t.$?.format ?? t.format?.[0] ?? "",
```

Add `format?: string` to `Target` in `types.ts` and a case to
`project-manifest.spec.ts` for each manifest version.

### 6.3 New file `src/targetsView.ts`

```ts
import {
  EventEmitter,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { ensureProjectList, projects } from "./project";
import { Target } from "./types";

export class TargetNode {
  constructor(public readonly target: Target) {}
}

export class PretextTargetsProvider implements TreeDataProvider<TargetNode> {
  private _onDidChangeTreeData = new EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TargetNode): TreeItem {
    const item = new TreeItem(node.target.name, TreeItemCollapsibleState.None);
    item.description = node.target.format ?? "";
    item.iconPath = new ThemeIcon("target");
    item.tooltip = `Target "${node.target.name}" in ${node.target.path}`;
    item.contextValue = "target";   // ← what view/item/context menus match on
    item.command = {
      command: "pretext-tools.revealTargetDefinition",
      title: "Open definition",
      arguments: [node],
    };
    return item;
  }

  async getChildren(node?: TargetNode): Promise<TargetNode[]> {
    if (node) return [];
    await ensureProjectList();
    return projects
      .filter((p) => !p.systemDefault)          // hide the ~/.ptx templates
      .flatMap((p) => p.targets)
      .filter((t) => !t.standalone)
      .map((t) => new TargetNode(t));
  }
}
```

(If you expect multi-root workspaces with several projects, add a parent level
per project — `getChildren()` returns project nodes first, then that project's
targets. Fine to skip initially.)

### 6.4 New commands (register in `extension.ts`)

```ts
const targetsProvider = new PretextTargetsProvider();
context.subscriptions.push(
  window.registerTreeDataProvider("pretextTargets", targetsProvider),
  commands.registerCommand("pretext-tools.buildTreeTarget", (node: TargetNode) =>
    buildTarget(node.target),
  ),
  commands.registerCommand("pretext-tools.viewTreeTarget", (node: TargetNode) =>
    viewTarget(node.target),
  ),
  commands.registerCommand("pretext-tools.revealTargetDefinition", async (node: TargetNode) => {
    const manifest = Uri.file(path.join(node.target.path, "project.ptx"));
    const doc = await workspace.openTextDocument(manifest);
    const editor = await window.showTextDocument(doc);
    const offset = doc.getText().indexOf(`name="${node.target.name}"`);
    if (offset >= 0) {
      const pos = doc.positionAt(offset);
      editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenter);
      editor.selection = new Selection(pos, pos);
    }
  }),
);
```

Also make the existing refresh command update the tree — either register a
wrapper in `extension.ts` that calls `resetProjectList()` then
`targetsProvider.refresh()`, or pass the provider into `refreshProjects()` in
[ui.ts](../packages/vscode-extension/src/ui.ts). (Note `resetProjectList` is
async — await it before refreshing the tree.)

### 6.5 `package.json` — commands, icons, menus, welcome

New command declarations (add to `contributes.commands`):

```json
{ "command": "pretext-tools.buildTreeTarget",  "title": "Build target",  "icon": "$(play)",         "category": "PreTeXt" },
{ "command": "pretext-tools.viewTreeTarget",   "title": "View target",   "icon": "$(open-preview)", "category": "PreTeXt" },
{ "command": "pretext-tools.revealTargetDefinition", "title": "Open target definition", "category": "PreTeXt" }
```

Add `"icon": "$(refresh)"` to the existing `pretext-tools.refreshTargets`
declaration so it can be a title-bar button.

Menus (these three-liners are what create the hover buttons):

```json
"menus": {
  "view/title": [
    { "command": "pretext-tools.refreshOutline", "when": "view == pretextDocumentOutline", "group": "navigation" },
    { "command": "pretext-tools.refreshTargets", "when": "view == pretextTargets",         "group": "navigation" }
  ],
  "view/item/context": [
    { "command": "pretext-tools.buildTreeTarget", "when": "view == pretextTargets && viewItem == target", "group": "inline@1" },
    { "command": "pretext-tools.viewTreeTarget",  "when": "view == pretextTargets && viewItem == target", "group": "inline@2" }
  ],
  "commandPalette": [
    { "command": "pretext-tools.buildTreeTarget", "when": "false" },
    { "command": "pretext-tools.viewTreeTarget",  "when": "false" },
    { "command": "pretext-tools.revealTargetDefinition", "when": "false" }
  ]
}
```

The `commandPalette` entries with `"when": "false"` hide the tree-only
commands from the palette (they need a tree node argument and would crash
without one).

Welcome content for the empty state:

```json
{
  "view": "pretextTargets",
  "contents": "No PreTeXt project found in this workspace.\n[New Project](command:pretext-tools.new)\n[Import Project](command:pretext-tools.importProject)"
}
```

### 6.6 Auto-refresh when `project.ptx` changes

In `extension.ts`:

```ts
const watcher = workspace.createFileSystemWatcher("**/project.ptx");
const onManifestChange = async () => {
  await resetProjectList();          // consider a silent variant — see note
  targetsProvider.refresh();
};
context.subscriptions.push(
  watcher, watcher.onDidChange(onManifestChange),
  watcher.onDidCreate(onManifestChange), watcher.onDidDelete(onManifestChange),
);
```

Note: `resetProjectList()` pops an info toast every time
([project.ts:23](../packages/vscode-extension/src/project.ts#L23)); move that
toast out to the manual-refresh command so file-watcher refreshes are silent.

### 6.7 Verify

F5 in a workspace with a `project.ptx`: targets listed with formats; hover a
row → ▶ and 👁 appear; ▶ actually builds (watch the status bar / output
channel); clicking the row opens `project.ptx` at the target; edit
`project.ptx` (add a target) → list updates; open an empty folder → welcome
text with working "New Project" link.

---

## 7. Phase 4 — Outline enhancements

### 7a. Blocks behind a setting

1. New setting in `package.json` → `configuration.properties`:

   ```json
   "pretext-tools.outline.showBlocks": {
     "type": "boolean",
     "default": false,
     "markdownDescription": "Show block-level elements (theorems, definitions, examples, figures, exercises, …) in the Document Outline in addition to divisions."
   }
   ```

2. In `outline-parser.ts`, add a `BLOCK_CONFIG` alongside `ELEMENT_CONFIG`
   (suggested groups/icons — tune to taste):

   ```ts
   export const BLOCK_CONFIG: Record<string, { icon: string; label: string }> = {
     theorem: { icon: "star", label: "Theorem" },
     lemma: { icon: "star", label: "Lemma" },
     corollary: { icon: "star", label: "Corollary" },
     proposition: { icon: "star", label: "Proposition" },
     definition: { icon: "symbol-key", label: "Definition" },
     axiom: { icon: "law", label: "Axiom" },
     example: { icon: "beaker", label: "Example" },
     question: { icon: "question", label: "Question" },
     problem: { icon: "beaker", label: "Problem" },
     exercise: { icon: "pencil", label: "Exercise" },
     activity: { icon: "tools", label: "Activity" },
     investigation: { icon: "search", label: "Investigation" },
     exploration: { icon: "compass", label: "Exploration" },
     project: { icon: "tools", label: "Project" },
     figure: { icon: "graph", label: "Figure" },
     table: { icon: "table", label: "Table" },
     listing: { icon: "code", label: "Listing" },
     remark: { icon: "comment", label: "Remark" },
     note: { icon: "comment", label: "Note" },
     warning: { icon: "warning", label: "Warning" },
     insight: { icon: "lightbulb", label: "Insight" },
     definitionlike: …  // extend from the gp* groups in constants.ts as desired
   };
   ```

3. Change the parser signature to
   `parseOutline(text: string, opts?: { includeBlocks?: boolean })`. Build the
   active tag set (and the `TAG_TOKEN` / `TAG_OPEN` regexes) from
   `OUTLINE_TAGS` plus, when enabled, `Object.keys(BLOCK_CONFIG)`. Since the
   regexes now depend on options, build them inside `parseOutline` (or memoize
   two variants). Blocks are **leaves** — never push them on the stack — so a
   figure inside an example simply attaches to the enclosing division; that's
   fine. The `extractTitle` early-stop from 4.2 must also stop at block tags
   when they're enabled, or an untitled section will steal its first theorem's
   title.

4. In `documentOutline.ts`, read the setting in `parseDocument()` and pass it
   through; refresh on config change:

   ```ts
   workspace.onDidChangeConfiguration((e) => {
     if (e.affectsConfiguration("pretext-tools.outline")) this.refresh();
   });
   ```

   Consider `TreeItemCollapsibleState.Collapsed` for divisions whose only
   children are blocks, so long chapters don't explode.

5. Tests: same fixtures with `includeBlocks: true/false`; theorem title via
   `<title>`; untitled-section-doesn't-steal-theorem-title regression.

### 7b. Project-wide outline (follow `xi:include`)

The design that keeps this testable: a new pure module that walks files via an
injected file reader, plus a small driver in the provider.

1. **New file `src/project-outline.ts`** (pure — no `vscode` import):

   ```ts
   import * as path from "path";
   import { parseOutline, OutlineItem } from "./outline-parser";

   export interface FileOutlineItem extends OutlineItem {
     file: string;                    // absolute path the item lives in
     children: FileOutlineItem[];
   }

   export async function parseProjectOutline(
     entryFile: string,
     readFile: (absPath: string) => Promise<string | undefined>,
     opts?: { includeBlocks?: boolean },
   ): Promise<FileOutlineItem[]> { … }
   ```

   Implementation sketch: teach `parseOutline` to also emit items for
   `<xi:include href="…"/>` (tag `"xi:include"`, the href stored where the
   title goes — easiest is to add `xi:include` to the scanned tag set and pull
   `href` from the same attribute-text trick used for `xml:id`). Then
   `parseProjectOutline` recursively replaces each `xi:include` item with the
   parsed outline of the referenced file (`path.resolve(path.dirname(current),
   href)`), attaching `file` to every item as it goes. Guard against include
   cycles with a `visited` set, and render unreadable hrefs as a
   `(missing: filename.ptx)` leaf instead of throwing.

2. **Find the entry file.** project.ptx v2 targets carry a `source` attribute
   (v1: `<source>` child). Extend `parseTargetsFromManifest` to capture it
   (same pattern as `format` in 6.2), and use the first non-standalone
   target's source; fall back to `source/main.ptx` under the project root.

3. **File reader** in `documentOutline.ts` — prefer unsaved editor content:

   ```ts
   async function readProjectFile(absPath: string): Promise<string | undefined> {
     const open = workspace.textDocuments.find((d) => d.uri.fsPath === absPath);
     if (open) return open.getText();
     try { return (await fs.promises.readFile(absPath, "utf8")); }
     catch { return undefined; }
   }
   ```

4. **Scope toggle.** Keep a `scope: "file" | "project"` field on the provider,
   persisted in `context.workspaceState`. Two commands
   (`pretext-tools.outlineScopeProject` / `…ScopeFile`) that flip it, refresh,
   and call `commands.executeCommand("setContext", "pretextOutline.scope", …)`.
   In `package.json`, declare both with icons (e.g. `$(file)` / `$(book)`) and
   contribute them to `view/title` with complementary `when` clauses
   (`view == pretextDocumentOutline && pretextOutline.scope == 'file'` shows
   the "switch to project" button, and vice versa) — this is the standard
   VS Code toggle-button pattern. Set the initial context value during
   activation, or neither button will show.

5. **Refresh triggers in project scope:** rebuild on `onDidSaveTextDocument`
   for `.ptx`/`.xml` files (project scope reads from disk, so per-keystroke
   updates of non-active files aren't possible anyway — document this in the
   toggle's tooltip). Keep the per-keystroke (debounced) refresh in file scope.

6. **Navigation already works across files**: `cmdOutlineJumpToLine`
   ([documentOutline.ts:203-226](../packages/vscode-extension/src/documentOutline.ts#L203-L226))
   opens `node.uri` when it isn't the active document — just build each
   `OutlineNode` with `Uri.file(item.file)` instead of the active editor's uri.

7. Tests for `project-outline.ts` with a fake `readFile` backed by an
   in-memory `{ path: contents }` map: nested includes, missing file, cycle.

---

## 8. Phase 5 — Optional polish (pick and choose)

- **Monochrome SVG activity-bar icon.** Replace `logo.png` in the
  `viewsContainers` contribution with a 24×24 SVG using `currentColor` fills so
  it themes correctly (keep `logo.png` as the marketplace icon).
- **`onLanguage:pretext` activation event** so the extension (and panel) works
  when a lone `.ptx` file is opened without a `project.ptx`.
- **Register or remove `pretext-tools.spellCheck`** (declared but
  unimplemented — currently errors from the palette).
- **Follow cursor in the outline.** Switch the outline to
  `window.createTreeView("pretextDocumentOutline", { treeDataProvider })`,
  implement `getParent()` on the provider (store a parent pointer when
  converting items), listen to `window.onDidChangeTextEditorSelection`, find
  the deepest node whose line ≤ cursor line, and call
  `treeView.reveal(node, { select: true, focus: false })`.
- **DocumentSymbolProvider** for `.ptx` files reusing `parseOutline` (~30
  lines with `languages.registerDocumentSymbolProvider`) — lights up
  breadcrumbs, the built-in Outline view, sticky scroll, and `Ctrl+Shift+O`
  for free. Cheap and high value.
- **Build-status badge**: with `createTreeView` handles you can set
  `treeView.badge = { value: 1, tooltip: "build running" }` while a build runs.

---

## 9. Suggested commit sequence

1. `fix(outline): parse tags in document order and ignore comments correctly` (4.1, 4.7 tests)
2. `fix(outline): stop title look-ahead at the next division` (4.2)
3. `feat(outline): recognize parts and specialized divisions` (4.3)
4. `fix(outline): keep outline when focus leaves the editor; debounce refresh` (4.4, 4.5)
5. `feat(sidebar): welcome content for empty views` (4.6 + 6.5's welcome)
6. `feat(sidebar): add Actions view` (Phase 2)
7. `refactor(build): extract parameterized buildTarget/viewTarget` (6.1, 6.2)
8. `feat(sidebar): add Targets view with inline build/view` (6.3–6.7)
9. `feat(outline): optional block-level items via setting` (7a)
10. `feat(outline): project-wide outline following xi:include` (7b)
11. Polish items as separate commits.

Each commit is releasable on its own via semantic-release.
