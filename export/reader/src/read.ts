/**
 * Read and validate an arrangement export (SPEC.md).
 *
 * - The version rule ("Versions"): `schema` must be "sas-arrangement-export/1";
 *   `exportVersion` (absent = 1.0.0) is read when its major is 1. A minor this
 *   reader doesn't know yet is read against the newest schema it knows (a
 *   minor only adds optional fields), with a warning; another major is refused.
 * - Validation: the JSON Schema of the file's version (bundled, no network),
 *   then the hashes the file carries that can be recomputed from it:
 *   `timingHash` and `scoreHash` when it has a score. (`arrangementHash`
 *   covers loop positions an export doesn't carry, and audio hashes need the
 *   audio: neither is checked here.)
 */
import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { payloadHash } from './canonical.js';
import { knownSchemas, latestKnown, type KnownSchema } from './schemas.js';
import { framesToSeconds } from './time.js';
import type { ExportFile, HashCheck, HashChecks, Layer, LayerNote, Note, ReadExport, Score, Section } from './types.js';

export const EXPORT_SCHEMA = 'sas-arrangement-export/1';

export type ExportReadErrorCode = 'not-json' | 'not-an-export' | 'unsupported-major' | 'invalid';

export class ExportReadError extends Error {
  constructor(
    readonly code: ExportReadErrorCode,
    message: string,
    readonly errors: string[] = []
  ) {
    super(errors.length > 0 ? `${message}\n${errors.map((e) => `  ${e}`).join('\n')}` : message);
    this.name = 'ExportReadError';
  }
}

export interface Validation {
  ok: boolean;
  /** The file's exportVersion ('1.0.0' when absent); null when it isn't an export. */
  version: string | null;
  /** The schema it was checked against. */
  schemaVersion: string | null;
  /** Why it is invalid: the schema's errors ("/path message"), a refused version, a hash mismatch. */
  errors: string[];
  warnings: string[];
  hashes: HashChecks;
  /** 'unsupported-major' etc. when the file was refused before its schema was applied. */
  refused?: ExportReadErrorCode;
}

type Validate = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null };
const compiled = new Map<string, Validate>();
function validatorFor(known: KnownSchema): Validate {
  let validate = compiled.get(known.version);
  if (!validate) {
    const ajv = new Ajv2020.default({ allErrors: true, strict: true });
    addFormats.default(ajv);
    validate = ajv.compile(known.schema) as Validate;
    compiled.set(known.version, validate);
  }
  return validate;
}

const NOT_CHECKED: HashChecks = { timing: 'not-checkable', score: 'not-checkable' };

/** Validate a parsed export.json (see the module comment). Never throws. */
export function validateExport(json: unknown): Validation {
  const fail = (refused: ExportReadErrorCode, version: string | null, error: string): Validation => ({
    ok: false,
    version,
    schemaVersion: null,
    errors: [error],
    warnings: [],
    hashes: NOT_CHECKED,
    refused,
  });
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return fail('not-an-export', null, 'not a JSON object');
  const file = json as Partial<ExportFile> & Record<string, unknown>;
  const family = typeof file.schema === 'string' ? /^sas-arrangement-export\/(\d+)$/.exec(file.schema) : null;
  if (!family) return fail('not-an-export', null, `"schema" is ${JSON.stringify(file.schema)}, not "${EXPORT_SCHEMA}"`);
  const version = file.exportVersion === undefined ? '1.0.0' : String(file.exportVersion);
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) return fail('invalid', version, `"exportVersion" ${JSON.stringify(file.exportVersion)} is not a version (major.minor.patch)`);
  const major = Number(parts[1]);
  const minor = Number(parts[2]);
  if (family[1] !== '1' || major !== 1) {
    return fail('unsupported-major', version, `export format ${major}.x (${file.schema}) is not readable by this reader (1.x only)`);
  }

  const warnings: string[] = [];
  const latest = latestKnown();
  let known = knownSchemas().find((s) => s.major === 1 && s.minor === minor);
  if (!known) {
    if (minor < latest.minor) return fail('invalid', version, `no schema for ${version} (this reader knows ${knownSchemas().map((s) => s.version).join(', ')})`);
    known = latest;
    warnings.push(`written by a newer format (${version}); read as ${latest.version}: what it adds is ignored`);
  }
  const validate = validatorFor(known);
  if (!validate(json)) {
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
    return { ok: false, version, schemaVersion: known.version, errors, warnings, hashes: NOT_CHECKED };
  }
  const hashes = checkHashes(json as ExportFile);
  const errors: string[] = [];
  if (hashes.timing === 'mismatch') errors.push('/timingHash does not match the timing it covers');
  if (hashes.score === 'mismatch') errors.push('/scoreHash does not match the score');
  return { ok: errors.length === 0, version, schemaVersion: known.version, errors, warnings, hashes };
}

/**
 * Read an export: a path to its export.json, or the parsed JSON. Validates it
 * first; throws ExportReadError when it can't be read (not JSON, not an
 * export, another major, invalid).
 */
export function readExport(input: string | object): ReadExport {
  let json: unknown = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(readFileSync(input, 'utf8'));
    } catch (e) {
      throw new ExportReadError('not-json', `${input}: ${(e as Error).message}`);
    }
  }
  const v = validateExport(json);
  if (!v.ok) {
    const code = v.refused ?? 'invalid';
    throw new ExportReadError(code, code === 'invalid' ? `invalid export (${v.schemaVersion ?? v.version ?? '?'})` : (v.errors[0] ?? code), code === 'invalid' ? v.errors : []);
  }
  return resolve(json as ExportFile, v);
}

function resolve(file: ExportFile, v: Validation): ReadExport {
  const sr = file.sampleRate;
  const score = file.score;
  const last = file.arrangement.instances[file.arrangement.instances.length - 1];
  const endFrame = file.arrangement.endFrame ?? (last ? last.startFrame + last.lengthFrames : 0);
  const sections: Section[] = file.arrangement.instances.map((inst, k) => {
    const s: Section = {
      instanceId: inst.instanceId,
      label: inst.label,
      startFrame: inst.startFrame,
      lengthFrames: inst.lengthFrames,
      startSeconds: framesToSeconds(inst.startFrame, sr),
      lengthSeconds: framesToSeconds(inst.lengthFrames, sr),
    };
    const own = score?.sections.find((x) => x.instanceId === inst.instanceId) ?? score?.sections[k];
    if (own) {
      s.sourceSceneId = own.sourceSceneId;
      s.firstBar = own.firstBar;
      s.lengthBars = own.lengthBars;
      if (own.role !== undefined) s.role = own.role;
    }
    return s;
  });

  let layers: Layer[] | null = null;
  let notes: Note[] | undefined;
  if (score) {
    const order = score.noteFields ?? ['frame', 'pitch', 'velocity', 'durationFrames'];
    const at = (name: string): number => order.indexOf(name);
    const [fi, pi, vi, di] = [at('frame'), at('pitch'), at('velocity'), at('durationFrames')];
    layers = score.layers.map((l): Layer => {
      const { notes: tuples, silent, ...rest } = l;
      const layer: Layer = { ...rest, silent: silent === true };
      if (tuples) {
        layer.notes = tuples.map((t): LayerNote => {
          const n: LayerNote = { frame: t[fi], pitch: t[pi], velocity: t[vi], durationFrames: t[di] };
          const piece = l.drumClass === 'kit' ? l.drumMap?.[String(n.pitch)] : l.drumClass;
          if (piece) n.drumClass = piece;
          return n;
        });
      }
      return layer;
    });
    if (layers.some((l) => l.notes)) {
      notes = layers
        .flatMap((l) => (l.notes ?? []).map((n): Note => ({ layerId: l.layerId, seconds: framesToSeconds(n.frame, sr), ...n })))
        .sort((a, b) => a.frame - b.frame || a.pitch - b.pitch || (a.layerId < b.layerId ? -1 : a.layerId > b.layerId ? 1 : 0));
    }
  }

  const out: ReadExport = {
    version: v.version!,
    schemaVersion: v.schemaVersion!,
    name: file.name,
    project: { ...file.project },
    sampleRate: sr,
    lengthSeconds: file.lengthSeconds,
    endFrame,
    tempoMap: score ? score.tempoMap : [{ bar: 1, beat: 0, frame: 0, bpm: file.project.bpm }],
    meterMap: score ? score.meterMap : null,
    bars: score ? score.bars : null,
    sections,
    layers,
    files: file.files,
    hashes: {
      timing: file.timingHash ?? null,
      arrangement: file.arrangementHash ?? null,
      score: file.scoreHash ?? null,
      audio: file.files.map((f) => ({ file: f.file, kind: f.kind, sha256: f.sha256 })),
    },
    hashChecks: v.hashes,
    warnings: v.warnings,
    raw: file,
  };
  if (notes) out.notes = notes;
  return out;
}

// ---------------------------------------------------------------------------
// Hashes (SPEC.md "Change detection")
// ---------------------------------------------------------------------------

/** The timing payload, rebuilt from the file — possible only with a score (1.0 / 1.1 don't carry the sections' meters). */
export function timingPayloadOf(file: ExportFile): unknown | null {
  const score = file.score;
  if (!score || file.arrangement.endFrame === undefined) return null;
  const meterAt = (bar: number): string => {
    let m = score.meterMap[0];
    for (const e of score.meterMap) if (e.bar <= bar) m = e;
    return m ? `${m.numerator}/${m.denominator}` : '4/4';
  };
  const sections = file.arrangement.instances.map((inst) => {
    const own = score.sections.find((s) => s.instanceId === inst.instanceId);
    return own
      ? { id: inst.instanceId, label: inst.label, meter: meterAt(own.firstBar), lengthBars: own.lengthBars, startFrame: inst.startFrame, lengthFrames: inst.lengthFrames }
      : null;
  });
  if (sections.some((s) => s === null)) return null;
  return { v: 1, sampleRate: file.sampleRate, bpm: file.project.bpm, endFrame: file.arrangement.endFrame, sections };
}

/** The score payload (`scoreHash`'s input). */
export function scorePayloadOf(score: Score, timingHash: string): unknown {
  return {
    v: 1,
    timingHash,
    sections: score.sections.map((s) => ({ id: s.instanceId, sourceSceneId: s.sourceSceneId, role: s.role ?? null })),
    layers: score.layers.map((l) => ({
      layerId: l.layerId,
      role: l.role,
      bucket: l.bucket,
      drumClass: l.drumClass ?? null,
      drumMap: l.drumMap ?? null,
      silent: l.silent === true,
      spans: l.spans,
      treatments: l.treatments,
      notes: l.notes ?? null,
    })),
  };
}

/** Recompute the hashes a file carries that its own content covers. */
export function checkHashes(file: ExportFile): HashChecks {
  const check = (claimed: string | undefined, payload: unknown | null): HashCheck =>
    claimed === undefined ? 'absent' : payload === null ? 'not-checkable' : payloadHash(payload) === claimed ? 'ok' : 'mismatch';
  return {
    timing: check(file.timingHash, timingPayloadOf(file)),
    score: check(file.scoreHash, file.score && file.timingHash !== undefined ? scorePayloadOf(file.score, file.timingHash) : null),
  };
}
