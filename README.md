# Signals & Sorcery arrangement export

The documented, versioned format of the `export.json` that
[Signals & Sorcery](https://signalsandsorcery.com) writes beside an arrangement export's audio.
It gives the song's tempo, sections and layers in audio frames, the files, and, from 1.2, the
resolved score: bars, where each layer plays, and its notes. A tool that follows the music (a
visual tool, a game engine, an analysis script) reads it instead of a project file.

The format page: <https://signalsandsorcery.com/contract/arrangement-export/>

## What's here

| Path | What |
|---|---|
| [`export/SPEC.md`](export/SPEC.md) | The format: every field, what it means, and the hashes. |
| [`export/schema/`](export/schema/) | JSON Schemas (2020-12), one per version, plus `v1`: the latest 1.x. |
| [`export/CHANGELOG.md`](export/CHANGELOG.md) | What changed in each version. |
| [`export/fixtures/`](export/fixtures/) | Fixtures: one per rule in the spec, example exports, and what consumers rely on. |
| [`export/reader/`](export/reader/) | The reference reader (TypeScript) and the `sas-export` command. |

## Versions

`exportVersion` is the format's [semantic version](https://semver.org). A minor version only
adds optional fields; a major one would change a meaning and is announced in the changelog
first. A reader accepts every 1.x file whose minor is at least the one it knows, ignores what it
doesn't know, and refuses another major. Each export names its schema in `$schema`, and every
version's schema is served at that URL.

## Validate an export

```sh
cd export/reader
npm install
npm run build
node dist/bin.js validate "My Song - export.json"
node dist/bin.js info "My Song - export.json"
```

`validate` checks a file against the schema of its version and recomputes the hashes it can
(`timingHash`, and `scoreHash` with a score). It exits 0 when every file is valid and 1
otherwise, listing what's wrong. `info` prints a summary; `info --json` prints the export as
the reader reads it.

## Read one from code

```ts
import { readExport, framesToSeconds } from './export/reader/dist/index.js';

const song = readExport('My Song - export.json'); // validates first; throws ExportReadError if it can't read it
for (const section of song.sections) console.log(section.label, section.startSeconds);
for (const bar of song.bars ?? []) console.log(bar.index, framesToSeconds(bar.startFrame, song.sampleRate));
for (const note of song.notes ?? []) console.log(note.layerId, note.seconds, note.pitch, note.drumClass);
```

`readExport` takes a path or parsed JSON. It returns the tempo and meter maps, the bars, the
sections, the layers (spans, effects, notes), every note in one list, the files and the hashes.
Exports before 1.2 carry no score, so they have no bars, meters or layers.

## Contribute a consumer fixture

If your tool reads these exports, add what it relies on, so that every change to the format
is checked against it before release. Put a `checks.json` in a folder of your own under
[`export/fixtures/consumers/`](export/fixtures/consumers/), with your export beside it or a
pointer to an example. It lists the values your tool depends on, such as "section 3 starts at
frame 4608000". The format is described in [`export/fixtures/README.md`](export/fixtures/README.md),
and `consumers/example/` is a template. Pull requests and issues are welcome, as are questions
where the spec is unclear.

This repository is published from Signals & Sorcery's source. Accepted changes are carried
there and come back here with the next release.

## Licence

MIT. See [LICENSE](LICENSE).
