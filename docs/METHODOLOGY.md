# How this dataset was made

## Two sources, legal act first

The data is built on two official sources, in this order, and every outcome is
tagged with which one it came from (`source: okmv | riigiteataja` in
`outcomes.*`, and `outcomesBySource` per curriculum in `manifest.json`).

1. **Riigi Teataja — the foundation.** The binding national curriculum (riiklik
   õppekava, a Vabariigi Valitsuse määrus) and its appendices (lisad), a public
   legal act. It defines the subject structure and the learning outcomes. The
   dataset is verified complete against it (see "Coverage" below).
2. **OKMV — the implementation layer, combined on top** (_Õppekava materjalide
   veeb_,
   [projektid.edu.ee/spaces/OKMV](https://projektid.edu.ee/spaces/OKMV/overview))
   – the Ministry of Education and Research's (Haridus- ja Teadusministeerium)
   official materials for implementing the curricula in effect since March 2023:
   the learning outcomes distributed by grade (_õpitulemuste jaotus klassiti_),
   recommended teaching content (_soovituslik õppesisu_), and methodological
   guidance (_soovituslikud juhised_).

OKMV nodes carry a numeric page id that resolves to
`https://projektid.edu.ee/pages/viewpage.action?pageId=<id>`; nodes taken
directly from the legal act carry a `law-*` page id and an "Allikas" link to
their Riigi Teataja source.

For rights, see the repository `NOTICE`: the legal act is a public act, and the
OKMV materials are the ministry's official implementation materials, reused here
with attribution.

Five curricula are published: the põhikool and gümnaasium national curricula,
and the three tracks of the simplified curriculum (lihtsustatud õpe / LÕK,
toimetulekuõpe / TÕK, hooldusõpe / HÕK).

## Coverage

The legal act is the checklist the dataset is measured against. For each
curriculum we extract every learning outcome (õpitulemus) from the Riigi Teataja
appendices into a per-subject, per-kooliaste inventory, then check each act
outcome against the data: an exact-text pass auto-confirms verbatim matches, and
a per-subject semantic pass judges the rest as covered, partial (present in
narrower or grade-split form), or missing. OKMV commonly rephrases and splits
one act outcome across several grade rows, so a single act outcome maps to one
or more of ours.

Every outcome the audit finds **missing** — absent from OKMV's materials — is
backfilled verbatim from the act (K/S/A/C-classified, tagged `riigiteataja`,
with an "Allikas" link), in place under the matching subject and kooliaste, so
the published dataset is complete against the act. Whole subjects OKMV does not
publish (e.g. the põhikool electives Karjääriõpetus, Draamaõpetus, Tantsuõpetus,
Teadusliku mõtlemise alused) are added the same way. The per-curriculum coverage
numbers (outcomes checked, covered, partial, backfilled) are in the `coverage`
block of `manifest.json`.

### Content beyond the outcomes

The 2023 reform act is competence-based. For core subjects it prescribes **no
õppesisu**: each subject appendix delegates content selection to the school and
teacher ("Õppesisu valib aineõpetaja arvestusega, et … õpitulemused oleksid
saavutatavad"), stating only the subject description, the outcomes, and a
per-subject list of _taotletavad teadmised, oskused ja hoiakud_ (target
knowledge, skills and attitudes). Prescribed, standardised õppesisu exists only
for the optional courses (the ainevaldkondade-ülesed and ainevaldkondlikud
valikkursused). We combine content on top of the act accordingly:

- **Elective õppesisu.** For every optional course the act fully specifies (e.g.
  the gümnaasium cross-field courses in lisa 15 and the field electives in lisa
  8), the course description, aims, õppesisu topics and assessment are extracted
  verbatim and attached to that course alongside its outcomes.
- **Competence targets.** The per-subject _taotletavad teadmised, oskused ja
  hoiakud_ are verified against our material the same way outcomes are — an
  exact/fuzzy pre-filter plus a semantic judge over the subject's whole scope
  (topics + outcomes). Of 610 core-subject competence targets (põhikool +
  gümnaasium), 588 are directly covered and 22 in narrower/partial form; none is
  absent. These competences are realised through the detailed õpitulemused,
  which are themselves verified complete against the act.
- **Field general provisions (ainevaldkonna üldalused).** Each ainevaldkond
  appendix opens with a "1. Üldalused" block — valdkonnapädevus, the arvestuslik
  maht (course/lesson-hour allocation), the field description and within-field
  integration, cross-field integration, õppe kavandamine, hindamine and
  õppekeskkond. Every core ainevaldkond page (põhikool's 8 fields,
  gümnaasium's 7) is checked section by section against the act's üldalused with
  a semantic judge; sections the act prescribes but our material lacked are
  backfilled verbatim from the act, with an "Allikas" link, in place on the
  field page. Of 105 üldalused sections checked, 59 were already present, 24 in
  a more concise form, and 22 were backfilled — most often 1.2 arvestuslik maht
  (the hour tables) and a field-level Hindamine or Õppekeskkond section. The
  simplified curricula (LÕK/TÕK/HÕK) have no ainevaldkonnad; their general part
  is a single curriculum-level üldosa. Each track's act general part (õppe- ja
  kasvatuseesmärgid, pädevused, taotletavad pädevused arengutasemeti,
  õppekorraldus, hindamine) was checked the same way against our üldosa — 33
  sections, none absent: the descriptive provisions are present in our material,
  and the act's staged competences are realised through the per-subject and
  per-tegevusvaldkond õpitulemused already verified complete against the act.

## From source to data

1. **Extraction.** Each source page is turned into a per-page content tree
   (`pages/<pageId>.json`) — outcomes split out of prose, learning outcomes
   classified K/S/A/C, resources typed as links/videos/files. This step uses
   assisted (LLM) judgement that a regular expression cannot apply, followed by
   a deterministic fidelity gate that checks each page against its source (no
   fabricated or dropped content, no lost resource links, valid shape).
2. **Merge** (`pnpm merge`). The per-page trees are assembled into whole
   curricula using the page hierarchy (`tree.json`). Learning outcomes that the
   source repeats across sibling levels are collapsed into a single
   content-addressed node with `secondaryParentRefs`.
3. **Validate** (`pnpm validate` + `pnpm check:schema`). The merged output is
   checked against the structural grammar and the JSON Schemas.
4. **Publish.** `manifest.json`, the flattened `outcomes.*` exports, and the
   static browsing site are regenerated from the merged curricula.

Only steps 2–4 run in this repository and are fully reproducible from the
published `pages/`. The extraction step (step 1) reads the source web and is not
part of this repository.

## Known limitations

- Extraction is assisted, not infallible. Reference tables rendered as images in
  the source are kept as images, not transcribed to structured tables. A small
  number of pages carry non-failing heuristic warnings (e.g. an outcome that
  reads like a list, a source table kept as prose).
- Exact in-page position of bulk external resource links is not always
  preserved; such links are recovered under a resources section rather than at
  their original scattered positions.
- The dataset is a snapshot. The state revises the curriculum periodically;
  releases are dated so consumers can pin a version.

## Reporting problems

Found something wrong? Please [open an issue](../CONTRIBUTING.md). Corrections
are welcome and are overlaid on the generated data at build time.
