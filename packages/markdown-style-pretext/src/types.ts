// The host-facing contract is shared with the LaTeX flavor: both packages
// implement the *same* `PretextFlavorLanguage`, so the VS Code LSP server and
// the Monaco adapter register a second entry with no other changes. We import
// (not redefine) that interface to guarantee the two flavors can never drift.
import type {
  PretextFlavorLanguage,
  GetCompletionsParams,
} from "@pretextbook/latex-style-pretext";

export type { PretextFlavorLanguage, GetCompletionsParams };

/**
 * The three remark-directive shapes this flavor understands:
 * - `container` — `:::name` … `:::` (block), the workhorse (theorem, exercise…)
 * - `leaf`      — `::name{…}` (a self-closing block; the PreTeXt Plus include
 *   syntax, so *any* name is accepted and none is ever "unknown")
 * - `text`      — `:name[…]{…}` (inline). The converter has no `textDirective`
 *   handler yet, so these are recognized by the scanner but neither completed
 *   nor linted (see the note in ./data/directives.ts).
 */
export type DirectiveKind = "container" | "leaf" | "text";

/**
 * Routing category, mirrored from `remark-pretext`'s `DirectiveCategory`. Kept
 * as a plain string union rather than imported so this package has no runtime
 * dependency on the converter (only a dev-time drift-guard test does).
 */
export type DirectiveCategory =
  | "theorem-like"
  | "proof-like"
  | "definition-like"
  | "axiom-like"
  | "remark-like"
  | "example-like"
  | "project-like"
  | "exercise-like"
  | "solution-like";

/**
 * Curated specification for a container directive. The direct analogue of the
 * LaTeX `EnvironmentSpec`: `requiresStatement` carries the same meaning (the
 * converter wraps the body in `<statement>` and hoists proof/solution siblings).
 *
 * Mirror of `DirectiveSpec` in
 *   packages/remark-pretext/src/lib/directive-map.ts
 * (the drift-guard test asserts every entry here still converts cleanly).
 */
export interface DirectiveSpec {
  /** Directive name as typed after the colons (usually the PreTeXt element). */
  name: string;
  /** The PreTeXt element the directive converts to. */
  type: string;
  category: DirectiveCategory;
  kind: DirectiveKind;
  /**
   * Converter wraps the body in `<statement>` and lifts proof/solution to
   * siblings of it. Drives the generated snippet skeleton.
   */
  requiresStatement: boolean;
  /** Whether the directive may contain nested `:::task` children. */
  hasNestedTasks?: boolean;
  /**
   * Directives meaningful directly inside this one (e.g. `proof` inside a
   * theorem; `hint`/`answer`/`solution` inside an exercise). Boosted in
   * completion sort order when the cursor is inside the parent.
   */
  childDirectives?: string[];
  /**
   * Override the auto-generated snippet body (LSP snippet syntax). The
   * generator always supplies the `name` line and the closing `:::` fence, so
   * this is the inner body only.
   */
  snippet?: string;
  documentation?: string;
}
