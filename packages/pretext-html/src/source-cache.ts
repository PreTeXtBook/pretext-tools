/**
 * A cache of parsed source files, so a re-render does not re-parse the parts
 * of a document that have not changed.
 *
 * What a render spends before the stylesheets even run is reading, parsing
 * and splicing every file the document xi:includes — and for a fragment
 * preview placed in its document (skeleton.ts), that is the *whole book*,
 * every keystroke, to produce a skeleton of a few hundred nodes. Parsing is
 * the expensive part: it is linear in the document, and a book is big.
 *
 * The cache is **per file, keyed by content**. Each entry holds one file's
 * pristine parse; a lookup with the same content is a hit, with different
 * content a miss that replaces the entry. Nothing is keyed by the assembled
 * document, so it does not matter how the project is chunked — one file or
 * two hundred, includes nested however deep. Editing a section re-parses that
 * section's file and nothing else; the rest of the book is spliced back
 * together from cached parses. That is what makes it usable both from disk
 * (the VS Code extension, which re-reads every file but only re-parses the
 * changed one) and from a browser host that holds its project in memory and
 * hands the renderer the same strings it handed it last time
 * (`RenderOptions.readSource`).
 *
 * Content is compared by string equality rather than hashed. A host that
 * keeps its files as strings passes the very same object for an unchanged
 * file, and V8 compares those by identity; a host that re-reads from disk
 * pays a byte comparison, which is a few microseconds per file against a
 * parse that is milliseconds.
 *
 * Trees handed out are **copies**. The renderer splices includes into the
 * tree, swaps the editor's buffer in for a division, prunes the rest to a
 * skeleton — all in place — and a cached parse must survive that untouched.
 * Copying a tree is an order of magnitude cheaper than parsing it (it walks
 * the nodes; the parser also has to walk the characters), and positions,
 * which are never mutated, are shared rather than copied.
 */

import { fromXml } from "xast-util-from-xml";
import type { Root, RootContent } from "xast";

interface Entry {
  content: string;
  tree: Root;
}

export interface SourceCacheOptions {
  /**
   * How many files to keep. The least recently used entry is evicted when a
   * new file would exceed it. Defaults to 1024 — enough for any project with
   * one file per division, which is the layout that produces the most files.
   */
  maxEntries?: number;
}

export class SourceCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  /** Cumulative hit/miss counts, for diagnostics and tests. */
  hits = 0;
  misses = 0;

  constructor(options: SourceCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 1024);
  }

  /**
   * The parse of `content`, as a fresh tree the caller may mutate freely.
   * `key` names the file — a path — so that a changed file replaces its own
   * entry instead of accumulating one per version.
   *
   * Throws what `fromXml` throws for malformed content; nothing is cached
   * then.
   */
  parse(key: string, content: string): Root {
    const cached = this.entries.get(key);
    if (cached && cached.content === content) {
      this.hits += 1;
      // Refresh recency: Map iteration order is insertion order.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cloneTree(cached.tree);
    }
    this.misses += 1;
    const tree = fromXml(content);
    this.entries.delete(key);
    this.entries.set(key, { content, tree });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return cloneTree(tree);
  }

  /** Number of files currently held. */
  get size(): number {
    return this.entries.size;
  }

  /** Drop one file (when the host knows it is gone), or everything. */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(key);
    }
  }
}

/**
 * Deep-copy an xast tree. Positions are shared (nothing ever mutates them);
 * attributes, children and `data` are copied, since the renderer mutates all
 * three (tagging included roots, injecting an `xml:id`, splicing and pruning).
 */
export function cloneTree<T extends Root | RootContent>(node: T): T {
  const copy = { ...node } as T & {
    attributes?: Record<string, string | null | undefined>;
    children?: RootContent[];
    data?: Record<string, unknown>;
  };
  if (copy.attributes) {
    copy.attributes = { ...copy.attributes };
  }
  if (copy.children) {
    copy.children = copy.children.map((child) => cloneTree(child));
  }
  if (copy.data) {
    copy.data = { ...copy.data };
  }
  return copy;
}
