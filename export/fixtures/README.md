# Fixtures

## `semantics/`

One file per rule in [SPEC.md](../SPEC.md). Each file is standalone and holds:
- `rule`, `spec` (the SPEC.md section) and, where a reading is often wrong, `misreading`;
- `bpm`, `sampleRate`;
- `catalog`: the scenes (`loopBars`, `meter`) and the layers with their home scene;
- `doc`: the arrangement;
- `expected`: the timing and arrangement payloads (SPEC.md "Change detection") with their
  hashes. That is what plays, as Signals & Sorcery's own lowering resolves it.

A reader that resolves `doc` with `catalog` should arrive at `expected`.

The `score-*.json` files (1.2) also hold `tracks`: each layer's role and its loop's notes, as
the project stores them. Their `expected` is the timing hash, the resolved `score` (SPEC.md
"Score") and its `scoreHash`.

## `consumers/`

What tools that read exports rely on, checked on every change to the format. Each folder
holds a `checks.json`:

```json
{
  "about": "What the tool does with the export, in a sentence.",
  "export": "export.json",
  "checks": [
    { "pointer": "/arrangement/instances/2/startFrame", "equals": 4608000, "why": "section 3 cuts here" }
  ]
}
```

- `export` is the export the checks read, relative to the folder: your own `export.json`
  beside it (the default), or one of the examples.
- Each check's `pointer` is a JSON Pointer (RFC 6901) into that export, and `equals` the value
  your tool expects there.

The export must be valid, and every check must hold. `consumers/example/` is a template.

## `examples/`

Complete `export.json` files, each valid against the schema of the version it declares:
- `export-1.0.0.json`
- `export-1.1.0.json`
- `export-1.1.0-path-free-44k-master.json`: no absolute paths, and a 44.1 kHz master from a
  48 kHz project.
- `export-1.2.0-score.json`: with the score and its notes. It includes a whole kit on one layer
  (`drumMap`) and a layer without MIDI.

Hashes of audio files and the engine are placeholders. Everything else is consistent.
