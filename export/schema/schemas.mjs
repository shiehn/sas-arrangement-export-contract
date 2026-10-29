#!/usr/bin/env node
/**
 * The arrangement export's JSON Schemas, built from one set of parts so each
 * minor can only ADD to the one before. `node schemas.mjs` rewrites the committed
 * files; a contract test checks they equal what this builds.
 *
 * Readers must ignore properties they don't know (a newer minor adds them), so
 * objects stay open (no additionalProperties: false).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (version) => `https://signalsandsorcery.com/contract/arrangement-export/${version}/schema.json`;
const hex64 = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const numOrNull = { type: ['number', 'null'] };
const nonEmpty = { type: 'string', minLength: 1 };
const frame = { type: 'integer', minimum: 0 };

/** Schema `version` (1.0.0, 1.1.0, 1.2.0, 1.3.0 or 1.4.0). */
export function buildSchema(version) {
  const v11 = version !== '1.0.0';
  const v12 = v11 && version !== '1.1.0';
  const v13 = v12 && version !== '1.2.0';
  const v14 = v13 && version !== '1.3.0';

  const instance = {
    type: 'object',
    description: 'A section: one instance on the timeline, in the export\'s `sampleRate` frames (SPEC.md "Sections").',
    required: ['instanceId', 'label', 'startFrame', 'lengthFrames'],
    properties: {
      instanceId: { ...nonEmpty, description: 'Stable across saves and re-exports (and across a project import).' },
      label: { type: ['string', 'null'], description: 'The instance label, or "<scene name> <ordinal>" (e.g. "Chorus 2").' },
      startFrame: frame,
      lengthFrames: frame,
    },
  };

  const file = {
    type: 'object',
    required: ['kind', 'label', 'file', 'sha256', 'frames', 'sampleRate', 'bitDepth', 'peakDbfs'],
    properties: {
      kind: { enum: ['mix', 'master', 'stem', 'editable'] },
      label: { type: 'string' },
      file: { ...nonEmpty, description: v11 ? 'Bundle-relative path, "/" separators.' : 'Bundle-relative path.' },
      sha256: { ...hex64, description: 'Of the whole file (header included): the audio hash.' },
      frames: { ...frame, description: "In the file's OWN sample rate." },
      sampleRate: { type: 'integer', minimum: 1 },
      bitDepth: { type: 'integer', minimum: 1 },
      peakDbfs: { ...numOrNull, description: 'Null when the file is silent.' },
      ...(v11
        ? {
            layerIds: {
              type: 'array',
              items: nonEmpty,
              uniqueItems: true,
              description: 'The layers (catalog track ids) a stem carries. Absent on the mix and master (every audible layer).',
            },
            startFrame: { const: 0, description: "The song frame of the file's first sample: always 0 (no pre-roll)." },
            latencyMs: { type: 'number', minimum: 0, description: 'Known UNcompensated latency, ms: 0 (SPEC.md "Alignment").' },
          }
        : {}),
    },
  };

  const exportTailOption = {
    oneOf: [
      { type: 'object', required: ['mode'], properties: { mode: { const: 'auto' } } },
      { type: 'object', required: ['mode', 'seconds'], properties: { mode: { const: 'fixed' }, seconds: { type: 'number', minimum: 0, maximum: 30 } } },
    ],
  };

  const options = {
    type: 'object',
    description: 'The export request, as made.',
    required: [...(v11 ? [] : ['destination']), 'mix', 'master', 'stems', 'editableStems', 'ableton', 'preset', 'masterBitDepth', 'stemBitDepth', 'renderStale'],
    properties: {
      destination: { type: 'string', description: v11 ? 'Absolute folder the export was written into; absent with pathFree.' : 'Absolute folder the export was written into.' },
      name: { type: 'string' },
      tail: exportTailOption,
      mix: { type: 'boolean' },
      master: { type: 'boolean' },
      stems: { type: 'boolean' },
      editableStems: { type: 'boolean' },
      ableton: { type: 'boolean' },
      preset: { enum: ['streaming', 'loud', 'custom'] },
      targetLufs: { type: 'number' },
      ceilingDbtp: { type: 'number' },
      masterBitDepth: { enum: [16, 24, 32] },
      stemBitDepth: { enum: [24, 32] },
      sampleRate: { enum: [44100, 48000, 96000], description: "The master's delivery rate (the other files stay at the export's sampleRate)." },
      renderStale: { type: 'boolean' },
      ...(v11 ? { pathFree: { type: 'boolean', description: 'Absolute paths were left out (SPEC.md "Privacy").' } } : {}),
      ...(v12
        ? {
            score: { type: 'boolean', description: 'The resolved `score` was asked for (SPEC.md "Score"). Absent = false.' },
            scoreNotes: { type: 'boolean', description: 'The score includes the notes. Absent = false.' },
          }
        : {}),
    },
  };

  const tail = {
    description: 'How far the audio runs past the last bar (SPEC.md "Tail").',
    oneOf: [
      {
        type: 'object',
        required: ['mode', 'capSeconds', 'floorDbfs'],
        properties: { mode: { const: 'auto' }, capSeconds: { type: 'number' }, floorDbfs: { type: 'number' } },
      },
      { type: 'object', required: ['mode', 'seconds'], properties: { mode: { const: 'fixed' }, seconds: { type: 'number', minimum: 0 } } },
    ],
  };

  const loudness = {
    type: 'object',
    required: [...(v11 ? [] : ['path']), 'integratedLufs', 'lra', 'truePeakDbtp', 'samplePeakDbfs', 'plrDb', 'durationS', 'sampleRate', 'channels', 'bitDepth', 'sampleFormat'],
    properties: {
      path: { type: 'string', description: v11 ? 'Absolute path of the measured file; absent with pathFree.' : 'Absolute path of the measured file.' },
      integratedLufs: numOrNull,
      lra: numOrNull,
      truePeakDbtp: numOrNull,
      samplePeakDbfs: numOrNull,
      plrDb: numOrNull,
      durationS: { type: 'number', minimum: 0 },
      sampleRate: { type: 'integer', minimum: 1 },
      channels: { type: 'integer', minimum: 1 },
      bitDepth: { type: 'integer', minimum: 1 },
      sampleFormat: { enum: ['pcm', 'float'] },
    },
  };

  const master = {
    type: 'object',
    required: ['elapsedMs', 'input', 'output', 'applied', 'warnings', 'preset', 'resampled'],
    properties: {
      elapsedMs: { type: 'number', minimum: 0 },
      input: loudness,
      output: { ...loudness, description: "The master file's loudness: integratedLufs and truePeakDbtp are the output's." },
      applied: {
        type: 'object',
        required: ['targetLufs', 'ceilingDbtp', 'iterations', 'oversampling', 'dither', 'seed', 'releaseMode'],
        properties: {
          targetLufs: { type: 'number' },
          ceilingDbtp: { type: 'number' },
          preGainDb: numOrNull,
          trimDb: numOrNull,
          maxGainReductionDb: numOrNull,
          meanGainReductionDb: numOrNull,
          limitingTimePct: numOrNull,
          iterations: { type: 'integer', minimum: 0 },
          oversampling: { type: 'integer', minimum: 1 },
          dither: { enum: ['tpdf', 'none'] },
          seed: { type: 'integer' },
          releaseMode: { type: 'string' },
          releaseMs: numOrNull,
          lookaheadMs: numOrNull,
        },
      },
      warnings: { type: 'array', items: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
      preset: { type: 'string' },
      resampled: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            required: ['fromRate', 'toRate', 'resampler'],
            properties: { fromRate: { type: 'integer', minimum: 1 }, toRate: { type: 'integer', minimum: 1 }, resampler: { type: 'string' } },
          },
        ],
      },
    },
  };

  const nullTest = {
    type: 'object',
    description: 'Σ stems − mix, when stems were rendered.',
    required: ['frames', 'residualPeakDbfs', 'residualRelativeDb', 'mixPeakDbfs', 'pass', 'thresholdDb', 'mismatches'],
    properties: {
      frames: frame,
      residualPeakDbfs: numOrNull,
      residualRelativeDb: numOrNull,
      mixPeakDbfs: numOrNull,
      pass: { type: 'boolean' },
      thresholdDb: { type: 'number' },
      mismatches: { type: 'array', items: { type: 'string' } },
    },
  };

  const bus = {
    type: 'object',
    required: ['busKey', 'fx'],
    properties: {
      busKey: { type: 'string' },
      fx: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'pluginId', 'enabled', 'version'],
          properties: { name: { type: 'string' }, pluginId: { type: 'string' }, enabled: { type: 'boolean' }, version: { type: ['string', 'null'] } },
        },
      },
    },
  };

  const arrangement = {
    type: 'object',
    required: ['id', 'name', 'planId', 'instances'],
    properties: {
      id: nonEmpty,
      name: { type: 'string' },
      planId: { type: 'string', description: 'A new id per render plan: never stable.' },
      instances: { type: 'array', items: instance, description: 'In timeline order: by (orderKey, id) in the arrangement.' },
      ...(v11
        ? {
            revision: {
              type: 'object',
              required: ['seq', 'docHash'],
              properties: {
                seq: { type: 'integer', minimum: 0, description: "The arrangement's latest applied edit batch: grows with every edit, not dense, local to the machine." },
                docHash: { ...hex64, description: "SHA-256 of the arrangement document's canonical JSON." },
              },
            },
            endFrame: { ...frame, description: "The last bar's end, in `sampleRate` frames." },
          }
        : {}),
      ...(v13
        ? {
            pickup: {
              type: 'object',
              description: 'The pickup bars before the first section (SPEC.md "Pickup bars"); absent when the song has none.',
              required: ['bars', 'startFrame', 'lengthFrames', 'instanceId'],
              properties: {
                bars: { type: 'integer', minimum: 1 },
                startFrame: { const: 0, description: 'The song starts with them.' },
                lengthFrames: frame,
                instanceId: { ...nonEmpty, description: 'The section they lead in to (= instances[0].instanceId), whose loop they play.' },
              },
            },
          }
        : {}),
    },
  };

  const bar = { type: 'integer', minimum: 1 };
  /** A song bar: from 1.3 the pickup's bars are 0, −1 … (SPEC.md "Pickup bars"). */
  const songBar = v13 ? { type: 'integer', description: 'Song bar: 1 = the first section\'s downbeat; the pickup bars are 0, −1 …' } : bar;
  const curve = { type: 'string', description: 'SPEC.md "Fades": equalPower (default; also any unknown name), linear, exponential, sCurve.' };
  const fade = { type: 'object', required: ['frames', 'curve'], properties: { frames: frame, curve } };
  const drumClass = { enum: ['kick', 'snare', 'hat', 'perc', 'cymbal', 'unknown'] };
  const score = {
    type: 'object',
    description: 'The resolved score (SPEC.md "Score"): the timing maps, the bar grid, the sections and every layer as it plays.',
    required: ['v', 'tempoMap', 'meterMap', 'bars', 'sections', 'layers'],
    properties: {
      v: { const: 1 },
      noteFields: { const: ['frame', 'pitch', 'velocity', 'durationFrames'], description: 'Present when the score includes notes: the order of a note tuple.' },
      tempoMap: {
        type: 'array',
        minItems: 1,
        items: { type: 'object', required: ['bar', 'beat', 'frame', 'bpm'], properties: { bar: songBar, beat: { type: 'number', minimum: 0 }, frame, bpm: { type: 'number', exclusiveMinimum: 0 } } },
      },
      meterMap: {
        type: 'array',
        items: {
          type: 'object',
          required: ['bar', 'beat', 'frame', 'numerator', 'denominator'],
          properties: { bar: songBar, beat: { type: 'number', minimum: 0 }, frame, numerator: { type: 'integer', minimum: 1 }, denominator: { type: 'integer', minimum: 1 } },
        },
      },
      bars: { type: 'array', items: { type: 'object', required: ['index', 'startFrame', 'lengthFrames'], properties: { index: songBar, startFrame: frame, lengthFrames: frame } } },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          required: ['instanceId', 'sourceSceneId', 'firstBar', 'lengthBars'],
          properties: {
            instanceId: { ...nonEmpty, description: '= arrangement.instances[].instanceId.' },
            sourceSceneId: nonEmpty,
            firstBar: bar,
            lengthBars: { type: 'integer', minimum: 1 },
            role: v14
              ? { ...nonEmpty, description: 'The section\'s part in the song form, as the host reads it, lower-case (verse, chorus, bridge …); absent when it gives none (SPEC.md "Lyrics").' }
              : { type: 'string', description: 'The section\'s role in the song form; absent until the arrangement carries one.' },
            ...(v14
              ? {
                  lyrics: {
                    type: 'object',
                    description: 'The words sung in this section (SPEC.md "Lyrics"): on every section when the song has words, absent on all when it has none.',
                    required: ['lines'],
                    properties: {
                      lines: { type: 'array', items: { type: 'string' }, description: 'One line per sung phrase, in order; [] when nothing is sung here. A repeat carries its words in full.' },
                    },
                  },
                }
              : {}),
          },
        },
      },
      ...(v13
        ? {
            pickup: {
              type: 'object',
              description: 'The pickup bars (SPEC.md "Pickup bars"): song bars firstBar … 0, played from the first section\'s loop; spans there name section "pickup".',
              required: ['firstBar', 'bars', 'instanceId', 'sourceSceneId'],
              properties: {
                firstBar: { type: 'integer', maximum: 0 },
                bars: { type: 'integer', minimum: 1 },
                instanceId: nonEmpty,
                sourceSceneId: nonEmpty,
              },
            },
          }
        : {}),
      layers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['layerId', 'name', 'role', 'bucket', 'spans', 'treatments'],
          properties: {
            layerId: { ...nonEmpty, description: 'The catalog track id (= files[].layerIds).' },
            name: { type: ['string', 'null'] },
            role: { type: ['string', 'null'] },
            bucket: { enum: ['drums', 'bass', 'harmony', 'top', null] },
            drumClass: { enum: ['kick', 'snare', 'hat', 'perc', 'cymbal', 'unknown', 'kit'] },
            drumMap: { type: 'object', propertyNames: { pattern: '^[0-9]{1,3}$' }, additionalProperties: drumClass },
            silent: { const: true },
            spans: {
              type: 'array',
              items: {
                type: 'object',
                required: ['section', 'startBar', 'endBar', 'startFrame', 'endFrame', 'gainDb', 'gainPoints'],
                properties: {
                  section: nonEmpty,
                  startBar: songBar,
                  endBar: songBar,
                  startFrame: frame,
                  endFrame: frame,
                  continues: { const: true },
                  gainDb: { type: 'number' },
                  gainPoints: { type: 'array', items: { type: 'object', required: ['frame', 'db'], properties: { frame, db: { type: 'number' } } } },
                  fadeIn: fade,
                  fadeOut: fade,
                },
              },
            },
            treatments: {
              type: 'array',
              items: {
                type: 'object',
                required: ['section', 'type', 'bar', 'bars', 'mode', 'startFrame', 'endFrame', 'params', 'gainDb'],
                properties: {
                  section: nonEmpty,
                  type: nonEmpty,
                  bar,
                  bars: { type: 'integer', minimum: 1 },
                  mode: { enum: ['replace', 'add'] },
                  startFrame: frame,
                  endFrame: frame,
                  params: { type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
                  gainDb: { type: 'number' },
                },
              },
            },
            notes: {
              type: 'array',
              items: {
                type: 'array',
                prefixItems: [frame, { type: 'integer', minimum: 0, maximum: 127 }, { type: 'integer', minimum: 1, maximum: 127 }, { type: 'integer', minimum: 1 }],
                minItems: 4,
                maxItems: 4,
                description: '[frame, pitch, velocity, durationFrames] (noteFields).',
              },
            },
          },
        },
      },
    },
  };

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: url(version),
    title: `Signals & Sorcery arrangement export ${version}`,
    description:
      'The export.json written beside an arrangement export\'s audio. Semantics: SPEC.md. Readers ignore properties they don\'t know, accept a higher minor version and refuse an unknown major.',
    type: 'object',
    required: [
      'schema',
      'renderedAt',
      'project',
      'arrangement',
      'contractVersion',
      'engine',
      'sampleRate',
      'lengthSeconds',
      'options',
      'name',
      'tail',
      'files',
      'master',
      'nullTest',
      'monoContent',
      'buses',
      'abletonBundle',
      'staleStemsRendered',
      'warnings',
    ],
    properties: {
      ...(v11
        ? {
            $schema: { type: 'string', format: 'uri', description: "The exact schema version's URL." },
            exportVersion: { type: 'string', pattern: '^1\\.[0-9]+\\.[0-9]+$', description: 'The format version; absent = 1.0.0.' },
            exportId: { type: 'string', format: 'uuid', description: 'New for every export.' },
            timingHash: { ...hex64, description: 'SPEC.md "Change detection".' },
            arrangementHash: { ...hex64, description: 'SPEC.md "Change detection".' },
          }
        : {}),
      ...(v12 ? { scoreHash: { ...hex64, description: 'SPEC.md "Change detection"; present with score.' }, score } : {}),
      ...(v14 ? { lyricsHash: { ...hex64, description: 'SPEC.md "Change detection"; present when the score carries the song\'s words.' } } : {}),
      schema: { const: 'sas-arrangement-export/1' },
      renderedAt: { type: 'string', format: 'date-time', description: 'When the export started (UTC).' },
      project: {
        type: 'object',
        required: ['id', 'name', 'bpm'],
        properties: {
          id: { ...nonEmpty, description: 'Local to the machine: a project imported elsewhere gets a new id.' },
          name: { type: 'string' },
          bpm: { type: 'number', exclusiveMinimum: 0, description: 'Quarter notes per minute; constant over the song.' },
        },
      },
      arrangement,
      contractVersion: { type: 'string', description: 'The arranger semantics the export was made under. Informational: it moves for changes that never touch the export.' },
      engine: { type: 'object', required: ['sha256'], properties: { sha256: { oneOf: [hex64, { type: 'null' }] } } },
      sampleRate: { type: 'integer', minimum: 1, description: 'The rate of every frame number in this file except files[].frames.' },
      lengthSeconds: { type: 'number', minimum: 0, description: 'The rendered length, tail included (the last bar ends earlier).' },
      options,
      name: { type: 'string' },
      tail,
      files: { type: 'array', items: file },
      master: { oneOf: [{ type: 'null' }, master] },
      nullTest: { oneOf: [{ type: 'null' }, nullTest] },
      monoContent: { type: 'boolean' },
      buses: { type: 'array', items: bus },
      abletonBundle: { type: ['string', 'null'] },
      staleStemsRendered: { type: 'integer', minimum: 0 },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

export const SCHEMA_FILES = {
  '1.0.0': 'sas-arrangement-export.v1.0.schema.json',
  '1.1.0': 'sas-arrangement-export.v1.1.schema.json',
  '1.2.0': 'sas-arrangement-export.v1.2.schema.json',
  '1.3.0': 'sas-arrangement-export.v1.3.schema.json',
  '1.4.0': 'sas-arrangement-export.v1.4.schema.json',
};

/** The latest 1.x. */
export const LATEST_V1 = '1.4.0';
export const ALIAS_FILE = 'sas-arrangement-export.v1.schema.json';

/**
 * The `v1` alias: the latest 1.x schema under its own id (…/v1/schema.json), for
 * a reader that validates "any 1.x up to the latest" without pinning a minor.
 */
export function buildAliasSchema() {
  return { ...buildSchema(LATEST_V1), $id: url('v1'), title: `Signals & Sorcery arrangement export 1.x (latest: ${LATEST_V1})` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const [version, name] of Object.entries(SCHEMA_FILES)) {
    writeFileSync(join(here, name), `${JSON.stringify(buildSchema(version), null, 2)}\n`);
    console.log(`wrote ${name}`);
  }
  writeFileSync(join(here, ALIAS_FILE), `${JSON.stringify(buildAliasSchema(), null, 2)}\n`);
  console.log(`wrote ${ALIAS_FILE}`);
}
