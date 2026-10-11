/**
 * The reference reader for Signals & Sorcery arrangement exports
 * (export.json). The format: ../SPEC.md; the schemas: ../schema/.
 */
export { canonicalJson, payloadHash, sha256Hex } from './canonical.js';
export { run as runCli, type Io } from './cli.js';
export { checkHashes, EXPORT_SCHEMA, ExportReadError, readExport, scorePayloadOf, timingPayloadOf, validateExport, type ExportReadErrorCode, type Validation } from './read.js';
export { knownSchemas, latestKnown, SCHEMA_DIR, type KnownSchema } from './schemas.js';
export { barAt, beatToFrame, framesToSeconds, sectionAt, secondsToFrames } from './time.js';
export type * from './types.js';
