# corrections/

Community corrections, overlaid on the generated data at build time.

Each file is `corrections/<pageId>.json` — a full replacement for the content
tree of the page `ee-curriculum:page:<pageId>`, in the same shape as
`pages/<pageId>.json` (see [`../docs/SCHEMA.md`](../docs/SCHEMA.md)).

When `merge` loads a page, it uses `corrections/<pageId>.json` if present,
otherwise `pages/<pageId>.json`. So a correction here overrides the generated
page and flows into `curricula/`, `manifest.json`, and `outcomes.*`.

## Outcome ids and text corrections

Every learning outcome has a permanent id (`outcome:<id>`), governed by
[`../identifiers.json`](../identifiers.json). The id is seeded once from the
outcome's content fingerprint (a hash of its normalized text + type) and then
frozen, so an outcome keeps its stable public URI
(`https://curriculum.praktikal.ee/o/<id>`) across rebuilds. The ledger is an
`allocated` list of every id ever minted, plus an `overrides` map for the few
outcomes whose current fingerprint differs from their id (after a correction) or
whose status changed. An id in `allocated` with no override hashes to itself.

A correction that only fixes surrounding content (tables, links, formatting)
needs nothing extra. A correction that **changes an outcome's wording** changes
its fingerprint, so the ledger must be told the new text is still the same
outcome, or `merge` would allocate it a new id and break existing links. The
usual flow is automatic:

1. Edit the correction, then run `pnpm merge` — it applies the overlay and
   allocates a stray id for the changed text.
2. Run `pnpm reconcile` — it pairs the changed outcome back to its existing id
   (within the corrected page, by text similarity) and records the remap in
   `identifiers.json`.
3. Run `pnpm merge` again so the curricula pick up the preserved id, then
   `pnpm check:identities` to confirm.
4. Commit `identifiers.json` and the rebuilt curricula alongside the correction.

`reconcile` auto-applies only confident pairings. If it reports an **ambiguous
page** (several outcomes changed at once, or an outcome split/merged), resolve
that page by hand: in `identifiers.json`, remove the stray new fingerprint from
`allocated`, and add an `overrides` entry keyed by the outcome's existing id —
its `fingerprint` set to the corrected text's hash and the old hash pushed into
`prior`:

```json
"overrides": {
  "<existing-id>": { "fingerprint": "<new-hash>", "prior": ["<old-hash>"], "status": "active" }
}
```

`pnpm check:identities` (run in CI) rebuilds with `--frozen-identities` and
fails if any outcome's fingerprint is not already in the ledger — so a wording
change or a genuinely new outcome cannot land without a committed ledger update.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the workflow.
