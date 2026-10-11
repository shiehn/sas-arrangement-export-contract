/**
 * The hash rule (SPEC.md "Change detection"): SHA-256, lower-case hex, of the
 * UTF-8 bytes of a payload's canonical JSON — object keys sorted by code unit
 * at every level, no whitespace, non-ASCII left unescaped.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The SPEC's hash of a payload. */
export function payloadHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}
