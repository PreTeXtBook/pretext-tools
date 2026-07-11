import { parseString } from 'xml2js';
import { Target } from './types';

/**
 * Parse the `<targets>` out of a `project.ptx` manifest.
 *
 * This is the pure, filesystem-free core of target discovery: given the raw
 * XML text of a manifest and the project root it lives in, return the list of
 * targets. Separated from `project.ts` so it can be unit tested without the
 * `vscode` API.
 *
 * A target counts as `standalone` when its `standalone` attribute is present
 * and not equal to `"no"`.
 */
export function parseTargetsFromManifest(
  contents: string,
  projectRoot: string,
): Target[] {
  let targets: Target[] = [];
  // parseString invokes its callback synchronously when given a string.
  parseString(contents, (err, result) => {
    if (err) {
      console.error('Error parsing project.ptx XML: ', err);
      return;
    }
    if (
      result?.project &&
      result.project.targets &&
      result.project.targets[0]?.target
    ) {
      targets = result.project.targets[0].target.map((t: any) => ({
        name: t.$?.name,
        path: projectRoot,
        standalone: (t.$?.standalone && t.$.standalone !== 'no') || false,
      }));
    }
  });
  return targets;
}
