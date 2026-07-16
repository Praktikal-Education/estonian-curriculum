# The curriculum JSON format

Two shapes, both validated by JSON Schemas in [`schema/`](../schema):

- **Per-page** (`pages/<pageId>.json`) — one source page as an ordered content
  tree. Schema: `schema/page.schema.json`.
- **Merged curriculum** (`curricula/<curriculum>.json`) — whole curricula
  assembled from the pages. Schema: `schema/curriculum.schema.json`.

The merged files are the primary artifact; the per-page files are the inputs the
`merge` step assembles.

## Merged curriculum

```json
{ "root": { "kind": "curriculum", "ref": "…", "fields": { … }, "children": [ … ] } }
```

Every node has:

| Field         | Notes                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| `ref`         | Stable identifier in the `ee-curriculum:` namespace (see below).                     |
| `kind`        | One of the node kinds below.                                                         |
| `fields`      | `title`, `summary`, `content`, `language`, `imageUrl`, `externalSrc` (all optional). |
| `externalRef` | `{ source, externalId, url? }` — provenance / idempotency key.                       |
| `children`    | Present on structural containers.                                                    |

### Node kinds

Structural containers (hold `children`):

- `curriculum` — the whole document root
- `schoolLevel` — kooliaste (I / II / III)
- `grade` — klass
- `subjectGroup` — ainevaldkond
- `subject` — õppeaine
- `topic` — a browsable/filterable curriculum theme (õppesisu teema)
- `section` — a plain structural heading
- `bridge` — a subject/level page reused across several parents (carries
  `bridgeKind` and `secondaryParentRef`)

Content leaves:

- `learningOutcome` — one õpitulemus; optional `outcomeType`
- `text`, `table` — HTML in `fields.content`
- `image` — `fields.imageUrl`
- `file`, `link`, `video`, `embed` — external URL in `fields.externalSrc`

### Structural grammar

Which kinds may parent which is enforced by `pnpm validate`, not by the JSON
Schema (which fixes node _shape_). In short: structural containers hold other
structural containers plus `learningOutcome`; only `topic` and `section` hold
content leaves.

## Identifiers

- **`ref`** — every node's id, namespaced `ee-curriculum:`. Page-derived nodes
  are `ee-curriculum:page:<id>`; synthetic structural nodes are
  `ee-curriculum:<kind>:<key>` (e.g. `ee-curriculum:grade:4`).
- **Source link** — the `<id>` in `ee-curriculum:page:<id>` is the real OKMV
  page id; it resolves to
  `https://projektid.edu.ee/pages/viewpage.action?pageId=<id>`.
- **Outcome ids** — learning outcomes use a content-addressed
  `externalId: "outcome:<hash>"` derived from the normalized outcome text +
  type. These are **stable across curricula**: an outcome shared between, say,
  põhikool and gümnaasium resolves to the same id, so cross-curriculum reuse is
  detectable. A shared outcome appears once in the tree, with
  `secondaryParentRefs` listing the other parents that own it.

## Outcome types

`knowledge` · `skill` · `attitude` · `competence` (K/S/A/C).

## Per-page format

`{ "content": [ ContentNode, … ] }`, an ordered tree using lowercase `kind`s:
`topic`/`section` (with `children`), `outcome` (`text`, optional `outcomeType`),
`text`/`table` (`html`), `image` (`src`, `alt?`), `file`/`link` (`src`/`href`,
`title?`), `video`/`embed` (`src`). Positions are the structure — nothing is
reordered by `merge`.
