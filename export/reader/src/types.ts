/**
 * The arrangement export as written (every 1.x version: what a version doesn't
 * have is optional here), and what the reader gives back. The meaning of every
 * field is in ../SPEC.md; the exact shapes are the JSON Schemas in ../schema/.
 */

export type DrumClass = 'kick' | 'snare' | 'hat' | 'perc' | 'cymbal' | 'unknown';
export type Bucket = 'drums' | 'bass' | 'harmony' | 'top';

export interface TempoEntry {
  bar: number;
  beat: number;
  frame: number;
  bpm: number;
}

export interface MeterEntry {
  bar: number;
  beat: number;
  frame: number;
  numerator: number;
  denominator: number;
}

export interface Bar {
  index: number;
  startFrame: number;
  lengthFrames: number;
}

export interface Fade {
  frames: number;
  curve: string;
}

export interface Span {
  section: string;
  startBar: number;
  endBar: number;
  startFrame: number;
  endFrame: number;
  continues?: true;
  gainDb: number;
  gainPoints: Array<{ frame: number; db: number }>;
  fadeIn?: Fade;
  fadeOut?: Fade;
}

export interface Treatment {
  section: string;
  type: string;
  bar: number;
  bars: number;
  mode: 'replace' | 'add';
  startFrame: number;
  endFrame: number;
  params: Record<string, number | string>;
  gainDb: number;
}

/** [frame, pitch, velocity, durationFrames] (score.noteFields). */
export type NoteTuple = [number, number, number, number];

export interface ScoreLayer {
  layerId: string;
  name: string | null;
  role: string | null;
  bucket: Bucket | null;
  drumClass?: DrumClass | 'kit';
  drumMap?: Record<string, DrumClass>;
  silent?: true;
  spans: Span[];
  treatments: Treatment[];
  notes?: NoteTuple[];
}

export interface Score {
  v: 1;
  noteFields?: readonly string[];
  tempoMap: TempoEntry[];
  meterMap: MeterEntry[];
  bars: Bar[];
  /** 1.4: `role` from the host, `lyrics` on every section when the song has words. */
  sections: Array<{ instanceId: string; sourceSceneId: string; firstBar: number; lengthBars: number; role?: string; lyrics?: { lines: string[] } }>;
  /** 1.3: the pickup bars (song bars firstBar … 0); absent when none. */
  pickup?: { firstBar: number; bars: number; instanceId: string; sourceSceneId: string };
  layers: ScoreLayer[];
}

/** 1.3: the song's pickup bars, before the first section, from frame 0. */
export interface Pickup {
  bars: number;
  startFrame: number;
  lengthFrames: number;
  /** The section they lead in to, whose loop they play. */
  instanceId: string;
}

export interface FileEntry {
  kind: 'mix' | 'master' | 'stem' | 'editable';
  label: string;
  file: string;
  sha256: string;
  /** In the file's OWN sample rate. */
  frames: number;
  sampleRate: number;
  bitDepth: number;
  peakDbfs: number | null;
  layerIds?: string[];
  startFrame?: number;
  latencyMs?: number;
}

/** The export.json, as written. */
export interface ExportFile {
  $schema?: string;
  schema: 'sas-arrangement-export/1';
  exportVersion?: string;
  exportId?: string;
  renderedAt: string;
  project: { id: string; name: string; bpm: number };
  arrangement: {
    id: string;
    name: string;
    planId: string;
    instances: Array<{ instanceId: string; label: string | null; startFrame: number; lengthFrames: number }>;
    revision?: { seq: number; docHash: string };
    endFrame?: number;
    pickup?: Pickup;
  };
  contractVersion: string;
  timingHash?: string;
  arrangementHash?: string;
  scoreHash?: string;
  /** 1.4: present when the score carries the song's words. */
  lyricsHash?: string;
  score?: Score;
  sampleRate: number;
  lengthSeconds: number;
  options: { score?: boolean; scoreNotes?: boolean; pathFree?: boolean; stems?: boolean; mix?: boolean; master?: boolean };
  name: string;
  files: FileEntry[];
}

// ---------------------------------------------------------------------------
// What the reader gives back
// ---------------------------------------------------------------------------

export interface Section {
  instanceId: string;
  label: string | null;
  startFrame: number;
  lengthFrames: number;
  startSeconds: number;
  lengthSeconds: number;
  /** With a score (1.2): the scene it plays, its first song bar and its length in bars. */
  sourceSceneId?: string;
  firstBar?: number;
  lengthBars?: number;
  role?: string;
  /** 1.4: the words sung here, one line per phrase ([] = none); absent when the song has no words. */
  lyrics?: string[];
}

export interface LayerNote {
  frame: number;
  pitch: number;
  velocity: number;
  durationFrames: number;
  /** The kit piece: the layer's drumClass, or its drumMap's for this pitch (a whole kit). */
  drumClass?: DrumClass;
}

export interface Layer extends Omit<ScoreLayer, 'notes' | 'silent'> {
  silent: boolean;
  notes?: LayerNote[];
}

/** Every layer's notes in one list, by frame then pitch. */
export interface Note extends LayerNote {
  layerId: string;
  seconds: number;
}

/** 'ok' · 'mismatch' · 'absent' (the file has no such hash) · 'not-checkable' (the file doesn't carry what it covers). */
export type HashCheck = 'ok' | 'mismatch' | 'absent' | 'not-checkable';

export interface HashChecks {
  timing: HashCheck;
  score: HashCheck;
  /** 1.4 */
  lyrics: HashCheck;
}

export interface ReadExport {
  /** The file's exportVersion ('1.0.0' when it has none). */
  version: string;
  /** The schema version it was validated against (a newer 1.x reads as the latest this reader knows). */
  schemaVersion: string;
  name: string;
  project: { id: string; name: string; bpm: number };
  sampleRate: number;
  lengthSeconds: number;
  /** The last bar's end (arrangement.endFrame, else the last section's end). */
  endFrame: number;
  /** The score's; without a score, the constant tempo from project.bpm. */
  tempoMap: TempoEntry[];
  /** The score's; null without a score (1.0 and 1.1 don't carry meters). */
  meterMap: MeterEntry[] | null;
  /** The score's; null without a score. */
  bars: Bar[] | null;
  sections: Section[];
  /** 1.3: the pickup bars before the first section; null when the song has none. */
  pickup: Pickup | null;
  /** The score's layers; null without a score. */
  layers: Layer[] | null;
  /** Every layer's notes, when the score has them. */
  notes?: Note[];
  files: FileEntry[];
  hashes: { timing: string | null; arrangement: string | null; score: string | null; lyrics: string | null; audio: Array<{ file: string; kind: string; sha256: string }> };
  hashChecks: HashChecks;
  warnings: string[];
  /** The validated file. */
  raw: ExportFile;
}
