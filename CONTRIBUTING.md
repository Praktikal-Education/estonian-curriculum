# Contributing

Thanks for helping improve the open Estonian curriculum data.

## This data is generated

`pages/` and `curricula/` are produced by a pipeline. **Do not hand-edit those
files** — the next regeneration overwrites them. Instead, corrections live in a
separate overlay so they survive regeneration and are easy to review.

## Reporting a problem

The lowest-effort path: [open an issue](../../issues/new/choose) using the
**Data correction** template. Include the source page (the
`ee-curriculum:page:<id>` ref or the projektid.edu.ee link), what's wrong, and
what it should say. A maintainer applies the fix.

## Proposing a correction (PR)

Add a file `corrections/<pageId>.json` — a full replacement for that page's
content tree, in the same shape as `pages/<pageId>.json` (see
[`docs/SCHEMA.md`](docs/SCHEMA.md)). At build time `merge` prefers a
`corrections/<pageId>.json` over the generated `pages/<pageId>.json`, so your
override flows into the merged curricula and everything derived from them.

Then regenerate and check locally:

```bash
pnpm build:data   # merge (applies corrections) + manifest + outcomes
pnpm check        # JSON Schema + structural grammar
```

Open a PR with the `corrections/` file and the regenerated artifacts. CI runs
the same `check`. Keep one page per file and describe the source-backed reason
for the change in the PR.

## Scope

This repo is the data and the deterministic engine (merge/validate/exports). The
extraction of new pages from the source web happens upstream and is not part of
this repository — corrections here override the published pages.
