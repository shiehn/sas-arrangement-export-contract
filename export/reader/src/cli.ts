/**
 * The `sas-export` command: `validate <file…>` (exit 0 when every file is
 * valid, 1 otherwise, each error listed) and `info <file> [--json]` (a
 * summary, or the read export as JSON).
 */
import { readFileSync } from 'node:fs';

import { ExportReadError, readExport, validateExport } from './read.js';
import type { ReadExport } from './types.js';

const USAGE = `Usage:
  sas-export validate <export.json>...   check each file against the schema of its version, and its hashes
  sas-export info <export.json> [--json] summarise an export (or print it, read, as JSON)
`;

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Run the CLI; returns the exit code (0 ok, 1 invalid, 2 usage). */
export function run(argv: readonly string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command === 'validate' && rest.length > 0) return validate(rest, io);
  if (command === 'info' && rest.filter((a) => a !== '--json').length === 1) return info(rest.find((a) => a !== '--json')!, rest.includes('--json'), io);
  if (command === '--help' || command === '-h' || command === 'help') {
    io.out(USAGE);
    return 0;
  }
  io.err(USAGE);
  return 2;
}

function validate(files: readonly string[], io: Io): number {
  let bad = 0;
  for (const path of files) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      bad++;
      io.out(`✗ ${path}: not JSON (${(e as Error).message})`);
      continue;
    }
    const v = validateExport(json);
    const hashes = Object.entries(v.hashes)
      .filter(([, c]) => c === 'ok')
      .map(([k]) => `${k}Hash ok`);
    if (v.ok) io.out(`✓ ${path} (${v.version}${v.schemaVersion !== v.version ? `, read as ${v.schemaVersion}` : ''}${hashes.length ? `; ${hashes.join(', ')}` : ''})`);
    else {
      bad++;
      io.out(`✗ ${path} (${v.version ?? 'not an export'})`);
      for (const e of v.errors) io.out(`    ${e}`);
    }
    for (const w of v.warnings) io.out(`    warning: ${w}`);
  }
  if (files.length > 1) io.out(`${files.length - bad} of ${files.length} valid`);
  return bad === 0 ? 0 : 1;
}

function info(path: string, json: boolean, io: Io): number {
  let e: ReadExport;
  try {
    e = readExport(path);
  } catch (error) {
    io.err(error instanceof ExportReadError ? error.message : String(error));
    return 1;
  }
  if (json) {
    const { raw: _raw, ...read } = e;
    io.out(JSON.stringify(read, null, 2));
    return 0;
  }
  const s = (frames: number) => `${(frames / e.sampleRate).toFixed(3)} s`;
  const bars = e.bars ? `${e.bars.length} bars · ` : '';
  io.out(`${e.name} — export ${e.version}${e.schemaVersion !== e.version ? ` (read as ${e.schemaVersion})` : ''}`);
  io.out(`  ${e.sampleRate} Hz · ${e.project.bpm} bpm · ${bars}${s(e.endFrame)} (files ${e.lengthSeconds.toFixed(3)} s with the tail)`);
  if (e.meterMap && e.meterMap.length > 1) io.out(`  meters: ${e.meterMap.map((m) => `bar ${m.bar} ${m.numerator}/${m.denominator}`).join(', ')}`);
  if (e.pickup) io.out(`  pickup: ${e.pickup.bars} bar${e.pickup.bars === 1 ? '' : 's'} (song bars ${1 - e.pickup.bars} … 0, ${s(e.pickup.lengthFrames)}) into ${e.pickup.instanceId}`);
  io.out(`  sections: ${e.sections.length}`);
  for (const sec of e.sections) {
    const where = sec.firstBar !== undefined ? `bar ${sec.firstBar}, ${sec.lengthBars} bars` : `${s(sec.lengthFrames)}`;
    io.out(`    ${(sec.label ?? sec.instanceId).padEnd(18)} ${s(sec.startFrame).padStart(11)}  ${where}${sec.role ? `  (${sec.role})` : ''}`);
  }
  const sung = e.sections.filter((sec) => sec.lyrics && sec.lyrics.length > 0);
  if (sung.length > 0) {
    const lines = sung.reduce((n, sec) => n + sec.lyrics!.length, 0);
    io.out(`  lyrics: ${lines} line${lines === 1 ? '' : 's'} in ${sung.length} of ${e.sections.length} sections`);
  }
  if (e.layers) {
    const buckets = new Map<string, number>();
    for (const l of e.layers) buckets.set(l.bucket ?? 'other', (buckets.get(l.bucket ?? 'other') ?? 0) + 1);
    const silent = e.layers.filter((l) => l.silent).length;
    io.out(`  layers: ${e.layers.length} (${[...buckets].map(([b, n]) => `${b} ${n}`).join(', ')})${silent ? `, ${silent} silent` : ''}${e.notes ? ` · notes: ${e.notes.length}` : ''}`);
  } else io.out('  layers: no score in this export');
  const kinds = new Map<string, number>();
  for (const f of e.files) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
  io.out(`  files: ${e.files.length} (${[...kinds].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')})`);
  const h = (x: string | null) => (x ? `${x.slice(0, 12)}…` : '—');
  io.out(`  hashes: timing ${h(e.hashes.timing)} (${e.hashChecks.timing}) · arrangement ${h(e.hashes.arrangement)} · score ${h(e.hashes.score)} (${e.hashChecks.score})${e.hashes.lyrics ? ` · lyrics ${h(e.hashes.lyrics)} (${e.hashChecks.lyrics})` : ''}`);
  for (const w of e.warnings) io.out(`  warning: ${w}`);
  return 0;
}
