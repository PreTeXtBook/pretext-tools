import type { DirectiveSpec } from "../types";

/**
 * The text inserted when completing a container directive, assuming the caller
 * has already typed the opening `:::` (the completion range covers the partial
 * name after it). Produces the name line, a body tab stop, and the closing
 * `:::` fence — the framing is always supplied here so an open can never be
 * generated without its matching close.
 *
 * A spec may override the body via `snippet` (body only). Directives with
 * nested tasks seed a first `:::task` child so the structure is discoverable.
 */
export function containerInsertText(spec: DirectiveSpec): string {
  if (spec.snippet) return `${spec.name}\n${spec.snippet}\n:::`;
  if (spec.hasNestedTasks) {
    return `${spec.name}\n:::task\n\t$0\n:::\n:::`;
  }
  return `${spec.name}\n\t$0\n:::`;
}

/** The bare closing fence, offered when a container directive is open. */
export function closeInsertText(): string {
  return ":::";
}

/**
 * The text inserted when completing a python-style directive, assuming the
 * caller has typed a bare line-start word (the completion range covers it).
 * Produces `Name:` and an indented body tab stop; the editor re-indents the
 * body relative to the marker line, so a single `\t` nests one level deeper.
 * Task-bearing directives seed a nested `task:` child.
 */
export function pythonInsertText(spec: DirectiveSpec): string {
  if (spec.hasNestedTasks) {
    return `${spec.name}:\n\ttask:\n\t\t$0`;
  }
  return `${spec.name}:\n\t$0`;
}

/**
 * The text inserted when completing a leaf directive, assuming the caller has
 * already typed the opening `::`. Leaf directives are PreTeXt Plus includes, so
 * they reference a target by `ref`.
 */
export function leafInsertText(spec: DirectiveSpec): string {
  return `${spec.name}{ref="$1"}`;
}
