/**
 * `sas-export validate` / `info`: exit codes and what they print, on the
 * contract's example exports and a tampered copy.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { run } from '../cli.js';

const EXAMPLES = fileURLToPath(new URL('../../../fixtures/examples/', import.meta.url));
const examples = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => join(EXAMPLES, f));
const SCORED = join(EXAMPLES, 'export-1.2.0-score.json');

function cli(...argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

describe('sas-export validate', () => {
  it('every example: exit 0, one ✓ line each, and the count', () => {
    const r = cli('validate', ...examples);
    expect(r.code).toBe(0);
    expect(r.out.filter((l) => l.startsWith('✓')).length).toBe(examples.length);
    expect(r.out[r.out.length - 1]).toBe(`${examples.length} of ${examples.length} valid`);
    expect(r.out.find((l) => l.includes('export-1.2.0-score.json'))).toMatch(/\(1\.2\.0; timingHash ok, scoreHash ok\)$/);
  });

  it('a tampered file: exit 1 and why', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sas-export-'));
    const bad = JSON.parse(readFileSync(SCORED, 'utf8')) as { arrangement: { instances: Array<{ startFrame: number }> } };
    bad.arrangement.instances[1].startFrame += 1;
    const path = join(dir, 'export.json');
    writeFileSync(path, JSON.stringify(bad));
    const r = cli('validate', SCORED, path);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${path} (1.2.0)`);
    expect(r.out).toContain('    /timingHash does not match the timing it covers');
    expect(r.out[r.out.length - 1]).toBe('1 of 2 valid');
    writeFileSync(path, '{ not json');
    expect(cli('validate', path).out[0]).toMatch(/^✗ .*: not JSON/);
  });
});

describe('sas-export info', () => {
  it('a summary of the 1.2 example', () => {
    const r = cli('info', SCORED);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe('Example Song — export 1.2.0');
    expect(r.out.join('\n')).toMatch(/sections: 3/);
    expect(r.out.join('\n')).toMatch(/layers: 8 \(.*\) · notes: \d+/);
    expect(r.out.join('\n')).toMatch(/timing [0-9a-f]{12}… \(ok\)/);
  });

  it('--json prints the read export (without the raw file)', () => {
    const r = cli('info', SCORED, '--json');
    const read = JSON.parse(r.out.join('\n')) as Record<string, unknown>;
    expect([r.code, read.version, 'raw' in read, Array.isArray(read.notes)]).toEqual([0, '1.2.0', false, true]);
  });

  it('usage errors exit 2; an unreadable file exits 1', () => {
    expect(cli().code).toBe(2);
    expect(cli('info').code).toBe(2);
    expect(cli('frobnicate', SCORED).code).toBe(2);
    expect(cli('--help').code).toBe(0);
    expect(cli('info', join(EXAMPLES, 'missing.json')).code).toBe(1);
  });
});
