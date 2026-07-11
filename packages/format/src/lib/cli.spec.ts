import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatPretext } from './format';

const cliPath = fileURLToPath(new URL('../../cli.cjs', import.meta.url));

function runCli(args: string[], input?: string) {
  return spawnSync('node', [cliPath, ...args], {
    encoding: 'utf8',
    input,
  });
}

describe('pretext-format CLI', () => {
  it('formats stdin to stdout', () => {
    const input = '<pretext><section><title>t</title></section></pretext>';
    const result = runCli(['--stdin'], input);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('\n  <section>');
    expect(result.stdout).not.toBe(input);
  });

  it('returns exit code 1 for --check when a file needs formatting', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pretext-format-'));
    const filePath = join(tempDir, 'sample.ptx');
    try {
      writeFileSync(
        filePath,
        '<pretext><section><title>t</title></section></pretext>',
        'utf8',
      );
      const result = runCli(['--check', filePath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(filePath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns exit code 0 for --check when a file is already formatted', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pretext-format-'));
    const filePath = join(tempDir, 'sample.ptx');
    try {
      const formatted = formatPretext(
        '<pretext><section><title>t</title></section></pretext>',
      );
      writeFileSync(filePath, formatted, 'utf8');
      const result = runCli(['--check', filePath]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes formatted output in-place with --write', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pretext-format-'));
    const filePath = join(tempDir, 'sample.ptx');
    try {
      writeFileSync(
        filePath,
        '<pretext><section><title>t</title></section></pretext>',
        'utf8',
      );
      const result = runCli(['--write', filePath]);
      expect(result.status).toBe(0);
      const updated = readFileSync(filePath, 'utf8');
      expect(updated).toContain('\n  <section>');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
