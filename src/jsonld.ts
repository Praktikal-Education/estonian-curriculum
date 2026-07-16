import * as fs from 'node:fs';
import * as path from 'node:path';
import { outcomeUri } from './identity';
import {
  type CurriculumImportAnyNode,
  type CurriculumImportRequest,
  CurriculumImportNodeKind as K,
  OutcomeType,
} from './types';

// Project the outcomes as linked data: a JSON-LD @context that bridges our
// vocabulary to schema.org (LRMI) and the national ontology schema.edu.ee, and
// an outcomes.jsonld graph typing every outcome against both. This is the
// semantic view the resolver serves for `Accept: application/ld+json`, and the
// concrete realisation of the schema.edu.ee mapping in the design.

const CURRICULA_DIR = path.resolve(__dirname, '../curricula');
const CONTEXT_FILE = path.resolve(__dirname, '../context.jsonld');
const OUTCOMES_JSONLD_FILE = path.resolve(__dirname, '../outcomes.jsonld');

const SCHEMA_ORG = 'https://schema.org/';
const EDU_EE = 'https://schema.edu.ee/';

// An outcome is a schema.org competency (DefinedTerm) and, in the national
// ontology, an Õpiväljund. Its outcomeType maps to the matching edu.ee class.
const OUTCOME_BASE_TYPES = ['schema:DefinedTerm', 'edu:Opivaljund'];
const OUTCOME_TYPE_CLASS: Record<OutcomeType, string> = {
  [OutcomeType.KNOWLEDGE]: 'edu:Teadmine',
  [OutcomeType.SKILL]: 'edu:Oskus',
  [OutcomeType.ATTITUDE]: 'edu:Hoiak',
  [OutcomeType.COMPETENCE]: 'edu:Padevus',
};

export function buildContext(): Record<string, unknown> {
  return {
    '@context': {
      schema: SCHEMA_ORG,
      edu: EDU_EE,
      dcterms: 'http://purl.org/dc/terms/',
      id: '@id',
      type: '@type',
      name: 'schema:name',
      curriculum: { '@id': 'dcterms:isPartOf', '@container': '@set' },
    },
  };
}

export interface OutcomeNode {
  id: string;
  type: string[];
  name: string;
  curriculum: string[];
}

function outcomeTypes(type: string | undefined): string[] {
  const cls = type ? OUTCOME_TYPE_CLASS[type as OutcomeType] : undefined;
  return cls ? [...OUTCOME_BASE_TYPES, cls] : [...OUTCOME_BASE_TYPES];
}

// Merge every occurrence of an outcome id into one node — a shared outcome lives
// once in the graph, listing every curriculum it belongs to.
export function buildOutcomesGraph(
  outcomes: { externalId: string; text: string; type?: string; curriculum: string }[],
): { '@context': unknown; '@graph': OutcomeNode[] } {
  const byId = new Map<string, OutcomeNode>();
  for (const o of outcomes) {
    const node = byId.get(o.externalId);
    if (node) {
      if (!node.curriculum.includes(o.curriculum)) node.curriculum.push(o.curriculum);
      continue;
    }
    byId.set(o.externalId, {
      id: outcomeUri(o.externalId),
      type: outcomeTypes(o.type),
      name: o.text,
      curriculum: [o.curriculum],
    });
  }

  const graph = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of graph) node.curriculum.sort();
  return { '@context': buildContext()['@context'], '@graph': graph };
}

function collectOutcomes(
  node: CurriculumImportAnyNode,
  curriculum: string,
  out: { externalId: string; text: string; type?: string; curriculum: string }[],
): void {
  if (node.kind === K.LEARNING_OUTCOME) {
    const externalId = node.externalRef?.externalId;
    if (externalId) {
      out.push({
        externalId,
        text: (node.fields?.summary ?? '').trim(),
        type: node.outcomeType,
        curriculum,
      });
    }
  }
  for (const child of 'children' in node ? (node.children ?? []) : [])
    collectOutcomes(child, curriculum, out);
}

function main(): void {
  const files = fs
    .readdirSync(CURRICULA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const outcomes: {
    externalId: string;
    text: string;
    type?: string;
    curriculum: string;
  }[] = [];
  for (const file of files) {
    const curriculum = file.replace(/\.json$/, '');
    const request = JSON.parse(
      fs.readFileSync(path.join(CURRICULA_DIR, file), 'utf-8'),
    ) as CurriculumImportRequest;
    collectOutcomes(request.root, curriculum, outcomes);
  }

  const graph = buildOutcomesGraph(outcomes);
  fs.writeFileSync(CONTEXT_FILE, `${JSON.stringify(buildContext(), null, 2)}\n`);
  fs.writeFileSync(OUTCOMES_JSONLD_FILE, `${JSON.stringify(graph, null, 2)}\n`);

  console.log(
    `✅ context.jsonld + outcomes.jsonld — ${graph['@graph'].length} outcome terms`,
  );
}

if (require.main === module) main();
