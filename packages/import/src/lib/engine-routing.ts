/**
 * Which converter handles which upload.
 *
 * The wizard used to ask the author to pick a converter before picking a file,
 * which made them learn something they have no way of knowing: that Word and
 * EPUB need pandoc while LaTeX and Markdown do not. The file itself already
 * says which converter can read it, so the routing is derived from its
 * extension instead, and nothing is asked up front.
 *
 * Precedence is the order the host lists its engines in: the first engine that
 * accepts an extension owns it. For a format two engines both read, the second
 * one is available as an `alternateFor` that upload — offered only once the
 * file is in hand and there is a converted result to judge it against, since
 * "would the other converter do better?" is not a question anyone can answer
 * before seeing the first one's output.
 */

/** The part of `ImportEngine` routing cares about. */
export interface RoutableEngine {
  id: string;
  label: string;
  description?: string;
  /** Extensions this engine accepts, with leading dots. */
  acceptExtensions?: string[];
}

/** File extensions accepted by the built-in converter. */
export const DEFAULT_ACCEPT_EXTENSIONS = [
  ".tex",
  ".md",
  ".markdown",
  ".ptx",
  ".xml",
  ".zip",
  ".gz",
  ".tar.gz",
  ".tgz",
];

/** What `engine` reads, falling back to the built-in set. */
export function engineExtensions(engine: RoutableEngine): string[] {
  return engine.acceptExtensions ?? DEFAULT_ACCEPT_EXTENSIONS;
}

/**
 * Does `fileName` end in one of `extensions`?
 *
 * Suffix matching rather than "the text after the last dot", because
 * `.tar.gz` is in the accept list and is not one dot's worth of extension.
 */
export function matchesExtension(
  fileName: string,
  extensions: string[],
): boolean {
  const lower = fileName.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

/** Can `engine` read a file named `fileName`? */
export function engineAccepts(
  engine: RoutableEngine,
  fileName: string,
): boolean {
  return matchesExtension(fileName, engineExtensions(engine));
}

/**
 * Every extension any engine reads, in engine order, deduplicated.
 *
 * This is the file picker's whole `accept` list: one picker, every format the
 * host can import, no converter chosen up front.
 */
export function allAcceptExtensions(engines: RoutableEngine[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const engine of engines) {
    for (const extension of engineExtensions(engine)) {
      if (!seen.has(extension)) {
        seen.add(extension);
        out.push(extension);
      }
    }
  }
  return out;
}

/**
 * The engine an author may opt into: the first one that duplicates coverage an
 * earlier engine already has. `undefined` when no two engines overlap, in
 * which case routing is fully determined by the file and there is nothing to
 * ask about.
 */
export function alternateEngine(
  engines: RoutableEngine[],
): RoutableEngine | undefined {
  for (let i = 1; i < engines.length; i++) {
    const earlier = engines.slice(0, i);
    const shares = engineExtensions(engines[i]).some((extension) =>
      earlier.some((engine) => engineExtensions(engine).includes(extension)),
    );
    if (shares) {
      return engines[i];
    }
  }
  return undefined;
}

/** Pick the engine for an upload, or `undefined` when nothing reads it. */
export function routeEngine<T extends RoutableEngine>(
  engines: T[],
  fileName: string,
): T | undefined {
  return engines.find((engine) => engineAccepts(engine, fileName));
}

/**
 * The second converter this particular upload could go through, or
 * `undefined` when it has only one.
 *
 * This is what makes the override self-explanatory: it exists for a `.tex`,
 * where both converters have an opinion, and simply is not there for a `.docx`
 * or a `.zip`, where only one converter can read the file at all. Nobody has
 * to be told which is which.
 */
export function alternateFor<T extends RoutableEngine>(
  engines: T[],
  fileName: string,
): T | undefined {
  const primary = routeEngine(engines, fileName);
  const alternate = alternateEngine(engines) as T | undefined;
  if (!primary || !alternate || alternate.id === primary.id) {
    return undefined;
  }
  return engineAccepts(alternate, fileName) ? alternate : undefined;
}

/** The message shown when no engine can read the file the author chose. */
export function unsupportedFileMessage(
  fileName: string,
  engines: RoutableEngine[],
): string {
  return `Cannot import ${fileName}: no converter reads that file type. Supported types are ${allAcceptExtensions(engines).join(", ")}.`;
}
