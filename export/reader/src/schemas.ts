/**
 * The JSON Schemas this reader knows: every `*.schema.json` in ../../schema/
 * (export/schema/ beside this package), keyed by the version in its `$id`
 * (`…/1.2.0/schema.json` → '1.2.0'; the `v1` alias is skipped). A new schema
 * file there is read without a code change.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = fileURLToPath(new URL('../../schema/', import.meta.url));

export interface KnownSchema {
  version: string;
  major: number;
  minor: number;
  schema: Record<string, unknown> & { $id: string };
}

let cache: KnownSchema[] | null = null;

/** The exact-version schemas, oldest first. */
export function knownSchemas(): KnownSchema[] {
  if (cache) return cache;
  const out: KnownSchema[] = [];
  for (const name of readdirSync(SCHEMA_DIR).sort()) {
    if (!name.endsWith('.schema.json')) continue;
    const schema = JSON.parse(readFileSync(new URL(name, new URL('../../schema/', import.meta.url)), 'utf8')) as KnownSchema['schema'];
    const match = /\/(\d+)\.(\d+)\.(\d+)\/schema\.json$/.exec(schema.$id ?? '');
    if (!match) continue;
    out.push({ version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]), minor: Number(match[2]), schema });
  }
  cache = out.sort((a, b) => a.major - b.major || a.minor - b.minor);
  return cache;
}

/** The newest 1.x this reader knows. */
export function latestKnown(): KnownSchema {
  const all = knownSchemas().filter((s) => s.major === 1);
  if (all.length === 0) throw new Error(`no 1.x schema in ${SCHEMA_DIR}`);
  return all[all.length - 1];
}
