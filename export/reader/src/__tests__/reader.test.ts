/**
 * The reference reader on every fixture of the contract: the example exports
 * read and validate against the schema of their version (and their hashes
 * recompute); every semantic fixture's hashes recompute with the reader's own
 * hash rule; the version rule; a tampered file is refused.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson, payloadHash } from '../canonical.js';
import { ExportReadError, readExport, scorePayloadOf, validateExport } from '../read.js';
import { knownSchemas, latestKnown } from '../schemas.js';
import { barAt, beatToFrame, framesToSeconds, sectionAt, secondsToFrames } from '../time.js';
import type { ExportFile, Score } from '../types.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const json = (rel: string): unknown => JSON.parse(readFileSync(`${FIXTURES}${rel}`, 'utf8'));
const EXAMPLES = readdirSync(`${FIXTURES}examples`).filter((f) => f.endsWith('.json')).sort();
const SEMANTICS = readdirSync(`${FIXTURES}semantics`).filter((f) => f.endsWith('.json')).sort();
const SCORED = 'examples/export-1.2.0-score.json';
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('the schemas the reader knows', () => {
  it('every exact version in ../schema, oldest first; the newest 1.x is the latest', () => {
    expect(knownSchemas().map((s) => s.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
    expect(latestKnown().version).toBe('1.2.0');
  });
});

describe('every example export', () => {
  it('there are examples of every version', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of EXAMPLES) {
    it(`${name}: valid against the schema of its version; read`, () => {
      const file = json(`examples/${name}`) as ExportFile;
      const v = validateExport(file);
      expect([v.ok, v.errors, v.warnings]).toEqual([true, [], []]);
      expect(v.schemaVersion).toBe(file.exportVersion ?? '1.0.0');
      const e = readExport(`${FIXTURES}examples/${name}`);
      expect(e.sections.map((s) => [s.instanceId, s.startFrame])).toEqual(file.arrangement.instances.map((i) => [i.instanceId, i.startFrame]));
      expect(e.tempoMap[0]).toMatchObject({ bar: 1, frame: 0, bpm: file.project.bpm });
      expect(e.hashes.audio.map((a) => a.sha256)).toEqual(file.files.map((f) => f.sha256));
    });
  }

  it('1.0 / 1.1 carry no score: no meters, bars or layers; their timing hash cannot be rebuilt (no meters)', () => {
    const e10 = readExport(`${FIXTURES}examples/export-1.0.0.json`);
    const e11 = readExport(`${FIXTURES}examples/export-1.1.0.json`);
    expect([e10.meterMap, e10.bars, e10.layers, e10.notes]).toEqual([null, null, null, undefined]);
    expect([e10.hashChecks, e11.hashChecks]).toEqual([
      { timing: 'absent', score: 'absent' },
      { timing: 'not-checkable', score: 'absent' },
    ]);
  });

  it('1.2 with a score: both hashes rebuilt and equal; sections gain their scenes and bars; notes as objects, by frame', () => {
    const e = readExport(`${FIXTURES}${SCORED}`);
    expect(e.hashChecks).toEqual({ timing: 'ok', score: 'ok' });
    expect(e.sections.map((s) => [s.sourceSceneId, s.firstBar, s.lengthBars])).toEqual([
      ['sc_a', 1, 4],
      ['sc_b', 5, 8],
      ['sc_c', 13, 4],
    ]);
    expect(e.bars!.length).toBe(16);
    const notes = e.notes!;
    expect(notes.length).toBe(e.layers!.reduce((n, l) => n + (l.notes?.length ?? 0), 0));
    notes.forEach((n, k) => k > 0 && expect(n.frame).toBeGreaterThanOrEqual(notes[k - 1].frame));
    expect(notes[0].seconds).toBe(framesToSeconds(notes[0].frame, e.sampleRate));
    // A whole kit: each note's piece from the layer's drumMap; a single piece: the layer's.
    const kit = e.layers!.find((l) => l.drumClass === 'kit')!;
    expect(new Set(kit.notes!.map((n) => `${n.pitch}:${n.drumClass}`))).toEqual(new Set(['36:kick', '38:snare', '42:hat']));
    expect(new Set(e.layers!.find((l) => l.layerId === 't_a_kick')!.notes!.map((n) => n.drumClass))).toEqual(new Set(['kick']));
    // A layer without MIDI has no notes.
    expect(e.layers!.find((l) => l.layerId === 't_c_perc')!.notes).toBeUndefined();
  });
});

describe('every semantic fixture: its hashes recompute with the reader\'s hash rule', () => {
  it('there are semantic fixtures', () => {
    expect(SEMANTICS.length).toBeGreaterThanOrEqual(14);
  });

  for (const name of SEMANTICS) {
    it(name, () => {
      const f = json(`semantics/${name}`) as { expected: Record<string, unknown> };
      const x = f.expected;
      if ('score' in x) {
        expect(payloadHash(scorePayloadOf(x.score as Score, x.timingHash as string))).toBe(x.scoreHash);
      } else {
        expect(payloadHash(x.timing)).toBe(x.timingHash);
        expect(payloadHash(x.arrangement)).toBe(x.arrangementHash);
      }
    });
  }
});

/** RFC 6901: the value at `pointer` in `doc` (undefined when there is none). */
function at(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), doc);
}

describe('consumer fixtures: what each tool relies on (fixtures/consumers/<name>/checks.json)', () => {
  const dir = `${FIXTURES}consumers`;
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(`${dir}/${n}/checks.json`)).sort() : [];

  it('the template is there', () => {
    expect(names).toContain('example');
  });

  for (const name of names) {
    it(`${name}: its export is valid and holds every value it relies on`, () => {
      const file = `${dir}/${name}/checks.json`;
      const spec = JSON.parse(readFileSync(file, 'utf8')) as { export?: string; checks: Array<{ pointer: string; equals: unknown; why?: string }> };
      const exportPath = resolve(dirname(file), spec.export ?? 'export.json');
      const doc = JSON.parse(readFileSync(exportPath, 'utf8')) as unknown;
      expect(validateExport(doc)).toMatchObject({ ok: true });
      expect(spec.checks.length).toBeGreaterThan(0);
      for (const c of spec.checks) expect([c.pointer, at(doc, c.pointer)], c.why).toEqual([c.pointer, c.equals]);
    });
  }
});

describe('the version rule', () => {
  const base = json(SCORED) as ExportFile;
  const refused = (mutate: (e: Record<string, unknown>) => void) => {
    const e = copy(base) as unknown as Record<string, unknown>;
    mutate(e);
    return validateExport(e);
  };

  it('another major is refused, by exportVersion or by schema', () => {
    expect(refused((e) => (e.exportVersion = '2.0.0'))).toMatchObject({ ok: false, refused: 'unsupported-major' });
    expect(refused((e) => (e.schema = 'sas-arrangement-export/2'))).toMatchObject({ ok: false, refused: 'unsupported-major' });
    expect(() => readExport({ ...copy(base), exportVersion: '2.0.0' })).toThrow(ExportReadError);
  });

  it('a higher minor is read against the newest schema known, with a warning; a lower minor against its own', () => {
    const newer = refused((e) => ((e.exportVersion = '1.9.0'), (e.someFutureField = { x: 1 })));
    expect([newer.ok, newer.schemaVersion, newer.warnings.length]).toEqual([true, '1.2.0', 1]);
    expect(refused((e) => (e.exportVersion = '1.1.4'))).toMatchObject({ ok: true, schemaVersion: '1.1.0' });
    expect(refused((e) => delete e.exportVersion)).toMatchObject({ ok: true, version: '1.0.0', schemaVersion: '1.0.0' });
  });

  it('not an export at all', () => {
    expect(validateExport({ hello: 1 })).toMatchObject({ ok: false, refused: 'not-an-export' });
    expect(validateExport('text')).toMatchObject({ ok: false, refused: 'not-an-export' });
    expect(refused((e) => (e.exportVersion = 'one'))).toMatchObject({ ok: false, refused: 'invalid' });
    try {
      readExport(`${FIXTURES}README.md`);
      expect.unreachable();
    } catch (e) {
      expect((e as ExportReadError).code).toBe('not-json');
    }
  });
});

describe('a tampered or broken file is invalid', () => {
  const base = json(SCORED) as ExportFile;

  it('a moved note breaks scoreHash; a moved section breaks timingHash; a schema violation lists its path', () => {
    const note = copy(base);
    note.score!.layers.find((l) => l.notes && l.notes.length > 0)!.notes![0][0] += 1;
    expect(validateExport(note)).toMatchObject({ ok: false, hashes: { timing: 'ok', score: 'mismatch' } });
    const section = copy(base);
    section.arrangement.instances[1].startFrame += 1;
    expect(validateExport(section)).toMatchObject({ ok: false, hashes: { timing: 'mismatch' } });
    const broken = copy(base) as unknown as { sampleRate: unknown };
    broken.sampleRate = 'fast';
    const v = validateExport(broken);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.startsWith('/sampleRate'))).toBe(true);
    expect(() => readExport(broken)).toThrow(/invalid export/);
  });
});

describe('time helpers', () => {
  it('beats, frames and seconds by the SPEC rule; the bar and section at a frame', () => {
    expect([beatToFrame(1, 120, 48000), beatToFrame(1, 89, 44100), secondsToFrames(0.5, 44100), framesToSeconds(24000, 48000)]).toEqual([24000, 29730, 22050, 0.5]);
    const e = readExport(`${FIXTURES}${SCORED}`);
    expect(barAt(e.bars!, 0)!.index).toBe(1);
    expect(barAt(e.bars!, e.bars![4].startFrame)!.index).toBe(5);
    expect(barAt(e.bars!, e.endFrame)).toBeNull();
    expect(sectionAt(e.sections, e.sections[2].startFrame + 1)!.instanceId).toBe(e.sections[2].instanceId);
  });

  it('canonical JSON: keys sorted at every level, no whitespace, undefined dropped', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 'é', c: undefined }], e: null })).toBe('{"a":[{"d":"é"}],"b":1,"e":null}');
  });
});
