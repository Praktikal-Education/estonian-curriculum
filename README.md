# Estonian national curriculum and its materials, as open data

Machine-readable JSON of the **Estonian national curriculum** (riiklik
õppekava): every school level, subject, topic, and learning outcome as one
structured tree you can query, validate, and build on.

It is built on two official sources, legal act first:

- **Riigi Teataja** – the binding national curriculum (Vabariigi Valitsuse
  määrus) and its appendices (lisad), a public legal act. This is the
  **foundation**: it defines the subject structure and the learning outcomes,
  and the dataset is **verified complete against it** (every õpitulemus in the
  act is present).
- **OKMV** (_Õppekava materjalide veeb_,
  [projektid.edu.ee/spaces/OKMV](https://projektid.edu.ee/spaces/OKMV/overview))
  – the Haridus- ja Teadusministeerium's official implementation materials,
  **combined onto that base**: outcomes distributed by grade (_õpitulemuste
  jaotus klassiti_), recommended teaching content (_soovituslik õppesisu_), and
  guidance (_soovituslikud juhised_).

Every outcome is tagged with its source. Where OKMV omits an outcome the act
requires, it is backfilled verbatim from the act. See [`NOTICE`](NOTICE) for the
licensing basis. This repository's contribution is combining the two sources,
the machine-readable structuring, stable identifiers, and the coverage
verification.

> 📖 To browse the curriculum with teaching materials built on top of it, use the
> [Praktikal](https://praktikal.app) apps. This repository is the underlying
> open dataset and the engine that produces it.

## What's here

| Curriculum                   | File                          |  Nodes | Outcomes |
| ---------------------------- | ----------------------------- | -----: | -------: |
| Põhikooli riiklik õppekava   | `curricula/pohikool.json`     | 21,656 |    4,026 |
| Gümnaasiumi riiklik õppekava | `curricula/gumnaasium.json`   | 12,292 |    1,957 |
| Lihtsustatud õpe (LÕK)       | `curricula/lihtsustatud.json` | 15,260 |    3,306 |
| Toimetulekuõpe (TÕK)         | `curricula/toimetulek.json`   |  2,482 |      669 |
| Hooldusõpe (HÕK)             | `curricula/hooldus.json`      |    811 |       63 |

```
pages/              per-source-page trees (one <pageId>.json each)
curricula/          the five merged curricula (the primary artifact)
manifest.json       machine catalog: curricula, counts, subjects, source links
outcomes.csv        every learning outcome as a flat table (+ .ndjson)
outcomes.jsonld     the outcomes as linked data (schema.org + schema.edu.ee)
context.jsonld      the JSON-LD @context bridging our terms to those ontologies
identifiers.json    the permanent outcome-id ledger (governs id stability)
schema/             JSON Schemas for pages and curricula
docs/               SCHEMA.md (the format) and METHODOLOGY.md (how it was made)
corrections/        community corrections overlaid at build time
src/                the deterministic engine (merge, validate, exports)
```

## Using the data

Each merged curriculum is a single tree: `{ "root": { … } }`. Structural
containers (`schoolLevel`, `grade`, `subject`, `topic`, `section`) hold
children; leaves are `learningOutcome`, `text`, `table`, `image`, `file`,
`link`, `video`, and `embed`. See [`docs/SCHEMA.md`](docs/SCHEMA.md) for the
full format.

Every node carries a stable `ref` in the `ee-curriculum:` namespace, and
page-derived nodes reference their source: `ee-curriculum:page:211453641`
resolves to `https://projektid.edu.ee/pages/viewpage.action?pageId=211453641`.

Learning outcomes carry a **permanent** id (`outcome:<id>`) governed by
`identifiers.json`. It is seeded from a content hash but frozen once minted, so
a corrected wording keeps its id. Ids are **stable across curricula** (a shared
outcome is the same id everywhere) and resolvable:
`https://curriculum.praktikal.ee/o/<id>`. The `uri` column in `outcomes.csv`
carries the resolvable form, and `outcomes.jsonld` types each outcome against
schema.org (`DefinedTerm`) and the national ontology
[schema.edu.ee](https://schema.edu.ee/) (`Opivaljund` + its outcome-type class).

Quickest starts:

- **Just the outcomes?** → `outcomes.csv` / `outcomes.ndjson`
- **Linked data / semantic web?** → `outcomes.jsonld` (+ `context.jsonld`)
- **Discovering what's available?** → `manifest.json`
- **The full structure?** → `curricula/*.json`

## Building it yourself

```bash
pnpm install
pnpm merge        # pages/ (+ corrections/) + tree.json → curricula/
pnpm validate     # structural grammar
pnpm check        # JSON Schema + validate
pnpm manifest     # regenerate manifest.json
pnpm outcomes     # regenerate outcomes.csv / .ndjson
pnpm jsonld       # regenerate context.jsonld / outcomes.jsonld
```

## Contributing corrections

The data is generated, but corrections are welcome — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). In short: open an issue, or add an
override under `corrections/`; the build overlays it on the generated page.

## License

- **Data** (`pages/`, `curricula/`, `manifest.json`, `outcomes.*`,
  `context.jsonld`, `identifiers.json`): [CC BY 4.0](LICENSE)
- **Code** (`src/`, `schema/`): [MIT](LICENSE-MIT)

Attribution details and the licensing basis (a public legal act as the
foundation, plus the ministry's official implementation materials combined on
top) are in [`NOTICE`](NOTICE).
