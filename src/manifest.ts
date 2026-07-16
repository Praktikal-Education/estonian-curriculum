import * as fs from 'node:fs';
import * as path from 'node:path';
import { OUTCOME_ID_NAMESPACE, OUTCOME_RESOLVER_BASE } from './identity';
import {
  type CurriculumImportAnyNode,
  type CurriculumImportRequest,
  CurriculumImportNodeKind as K,
} from './types';

// Build manifest.json — a machine-readable catalog of the published curricula
// (ids, titles, source page, node/outcome counts, subject lists). The best
// programmatic entry point for consumers.
const CURRICULA_DIR = path.resolve(__dirname, '../curricula');
const MANIFEST_FILE = path.resolve(__dirname, '../manifest.json');
const COVERAGE_SUMMARY_FILE = path.resolve(__dirname, '../coverage-summary.json');
const SOURCE_PAGE_URL = 'https://projektid.edu.ee/pages/viewpage.action?pageId=';

interface CoverageEntry {
  actOutcomes: number;
  covered: number;
  partial: number;
  missing: number;
  backfilled: number;
}
interface CoverageSummary {
  source: string;
  curricula: Record<string, CoverageEntry>;
}

function loadCoverage(): CoverageSummary | null {
  if (!fs.existsSync(COVERAGE_SUMMARY_FILE)) return null;
  return JSON.parse(fs.readFileSync(COVERAGE_SUMMARY_FILE, 'utf-8')) as CoverageSummary;
}

function walk(
  node: CurriculumImportAnyNode,
  visit: (n: CurriculumImportAnyNode, pageId: string | null) => void,
  pageId: string | null = null,
): void {
  const own = node.ref?.match(/:page:([^:]+)/)?.[1] ?? null;
  const currentPage = own ?? pageId;
  visit(node, currentPage);
  for (const child of 'children' in node ? (node.children ?? []) : [])
    walk(child, visit, currentPage);
}

// The dataset draws on two sources. Most nodes come from OKMV (numeric page ids);
// a small set of põhikool electives OKMV does not publish are taken from the
// Riigi Teataja legal act (law-* page ids).
function sourceOfPageId(id: string | null): 'okmv' | 'riigiteataja' {
  return id?.startsWith('law-') ? 'riigiteataja' : 'okmv';
}

function sourcePageId(node: CurriculumImportAnyNode): string | null {
  const ext = node.externalRef?.externalId ?? '';
  const m = ext.match(/^page:(\d+)$/);
  return m ? m[1] : null;
}

function main(): void {
  const coverage = loadCoverage();
  const files = fs
    .readdirSync(CURRICULA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const curricula = files.map((file) => {
    const id = file.replace(/\.json$/, '');
    const request = JSON.parse(
      fs.readFileSync(path.join(CURRICULA_DIR, file), 'utf-8'),
    ) as CurriculumImportRequest;

    const counts: Record<string, number> = {};
    const subjects: string[] = [];
    const outcomesBySource = { okmv: 0, riigiteataja: 0 };
    walk(request.root, (n, page) => {
      counts[n.kind] = (counts[n.kind] ?? 0) + 1;
      if (n.kind === K.SUBJECT && n.fields?.title) subjects.push(n.fields.title);
      if (n.kind === K.LEARNING_OUTCOME) outcomesBySource[sourceOfPageId(page)] += 1;
    });

    const pageId = sourcePageId(request.root);
    return {
      id,
      title: request.root.fields?.title ?? id,
      file: `curricula/${file}`,
      rootRef: request.root.ref,
      sourcePageId: pageId,
      sourceUrl: pageId ? `${SOURCE_PAGE_URL}${pageId}` : null,
      nodes: Object.values(counts).reduce((a, b) => a + b, 0),
      outcomes: counts[K.LEARNING_OUTCOME] ?? 0,
      outcomesBySource,
      ...(coverage?.curricula[id] ? { coverage: coverage.curricula[id] } : {}),
      subjects: subjects.sort((a, b) => a.localeCompare(b, 'et')),
      counts,
    };
  });

  const manifest = {
    name: 'estonian-curriculum',
    description:
      'The Estonian national curriculum as defined by its binding legal acts, enriched with the ministry’s official OKMV implementation materials, as open, machine-readable data',
    idNamespace: OUTCOME_ID_NAMESPACE,
    schema: 'schema/curriculum.schema.json',
    // Learning outcomes carry a permanent 16-hex id governed by identifiers.json.
    // The id is opaque and flat: it never encodes curriculum, subject or grade,
    // because an outcome is shared across curricula and its position is expressed
    // by edges, not by the identifier. A corrected wording keeps its id.
    outcomeIdentifiers: {
      namespace: OUTCOME_ID_NAMESPACE,
      curie: `${OUTCOME_ID_NAMESPACE}:o:{id}`,
      resolver: `${OUTCOME_RESOLVER_BASE}{id}`,
      ledger: 'identifiers.json',
      context: 'context.jsonld',
      linkedData: 'outcomes.jsonld',
    },
    // The legal act is the foundation of the dataset (subject structure and the
    // binding learning outcomes); OKMV is the implementation layer combined on
    // top (grade-by-grade distribution, recommended content, resources).
    sources: [
      {
        id: 'riigiteataja',
        role: 'legal-act',
        name: 'Riigi Teataja — riiklikud õppekavad',
        url: 'https://www.riigiteataja.ee/akt/129082014020?leiaKehtiv',
        maintainer: 'Vabariigi Valitsus (Haridus- ja Teadusministeerium)',
        note: 'The binding national curriculum (Vabariigi Valitsuse määrus) and its appendices (lisad) — a public legal act. It defines the subject structure and the learning outcomes; the dataset is verified complete against it. Nodes taken directly from the act have law-* page ids and carry an "Allikas" link.',
      },
      {
        id: 'okmv',
        role: 'implementation-materials',
        name: 'OKMV — Õppekava materjalide veeb',
        url: 'https://projektid.edu.ee/spaces/OKMV/overview',
        maintainer: 'Haridus- ja Teadusministeerium',
        note: "The ministry's official materials for implementing the national curricula (in effect since March 2023), combined onto the legal-act base: the grade-by-grade distribution of the learning outcomes, recommended teaching content, and guidance. Nodes from this source have numeric page ids.",
      },
    ],
    ...(coverage ? { coverage: { method: coverage.source } } : {}),
    curricula,
    totals: {
      curricula: curricula.length,
      nodes: curricula.reduce((a, c) => a + c.nodes, 0),
      outcomes: curricula.reduce((a, c) => a + c.outcomes, 0),
    },
  };

  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `✅ manifest.json — ${manifest.totals.curricula} curricula, ${manifest.totals.nodes} nodes, ${manifest.totals.outcomes} outcomes`,
  );
}

if (require.main === module) main();
