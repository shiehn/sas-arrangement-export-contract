/**
 * Frames, seconds and beats (SPEC.md "Timing"): every frame in an export is
 * at its top-level `sampleRate`, from the song start.
 */
import type { Bar, Section } from './types.js';

export const framesToSeconds = (frames: number, sampleRate: number): number => frames / sampleRate;

/** The nearest frame (½ rounds up), as the export rounds. */
export const secondsToFrames = (seconds: number, sampleRate: number): number => Math.floor(seconds * sampleRate + 0.5);

/** frame(beat) = floor(beat × 60 × sampleRate / bpm + ½), beats being quarter notes from the song start. */
export const beatToFrame = (beat: number, bpm: number, sampleRate: number): number => Math.floor((beat * 60 * sampleRate) / bpm + 0.5);

/** The bar (or section) a frame falls in; null before the first or past the last. */
export function barAt(bars: readonly Bar[], frame: number): Bar | null {
  return findSpan(bars, frame, (b) => b.startFrame, (b) => b.lengthFrames);
}

export function sectionAt(sections: readonly Section[], frame: number): Section | null {
  return findSpan(sections, frame, (s) => s.startFrame, (s) => s.lengthFrames);
}

function findSpan<T>(items: readonly T[], frame: number, start: (t: T) => number, length: (t: T) => number): T | null {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = start(items[mid]);
    if (frame < s) hi = mid - 1;
    else if (frame >= s + length(items[mid])) lo = mid + 1;
    else return items[mid];
  }
  return null;
}
