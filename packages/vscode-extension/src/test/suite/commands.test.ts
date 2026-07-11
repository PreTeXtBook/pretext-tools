import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'oscarlevin.pretext-tools';

/**
 * Commands that are declared in `package.json` (`contributes.commands`) but
 * intentionally have no runtime handler yet. Keep this list SHORT and tracked —
 * each entry is a command that currently errors when invoked from the palette.
 *
 * - `pretext-tools.spellCheck`: declared with the title "Spell Check PreTeXt"
 *   but no `registerCommand` handler exists. Needs to be implemented (or the
 *   manifest entry removed). Tracked separately.
 */
const KNOWN_UNREGISTERED = new Set<string>(['pretext-tools.spellCheck']);

suite('Command registration', () => {
  test('every command declared in the manifest has a registered handler', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
    await ext!.activate();

    const declared: string[] = (
      ext!.packageJSON?.contributes?.commands ?? []
    ).map((c: { command: string }) => c.command);
    assert.ok(declared.length > 0, 'Manifest should declare commands');

    const registered = new Set(await vscode.commands.getCommands(true));

    const missing = declared.filter(
      (cmd) => !registered.has(cmd) && !KNOWN_UNREGISTERED.has(cmd),
    );

    assert.deepStrictEqual(
      missing,
      [],
      `These declared commands have no registered handler: ${missing.join(', ')}`,
    );
  });

  test('known-unregistered commands are still actually missing (keep the allowlist honest)', async () => {
    // If one of these gets implemented, this test fails so we prune the list.
    const registered = new Set(await vscode.commands.getCommands(true));
    const nowRegistered = [...KNOWN_UNREGISTERED].filter((c) =>
      registered.has(c),
    );
    assert.deepStrictEqual(
      nowRegistered,
      [],
      `These are now registered — remove them from KNOWN_UNREGISTERED: ${nowRegistered.join(', ')}`,
    );
  });
});
