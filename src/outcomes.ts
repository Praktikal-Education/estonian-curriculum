import * as fs from 'node:fs';
import * as path from 'node:path';
import { outcomeUri } from './identity';
import {
  type CurriculumImportAnyNode,
  type CurriculumImportRequest,
  CurriculumImportNodeKind as K,
} from './types';

// Flatten every learning outcome across all curricula into a single table
// (outcomes.csv + outcomes.ndjson): stable id, resolvable uri, curriculum,
// source (okmv / riigiteataja), subject, type, and text. The researcher- and
// tool-friendly view of the data.
const CURRICULA_DIR = path.resolve(__dirname, '../curricula');
const CSV_FILE = path.resolve(__dirname, '../outcomes.csv');
const NDJSON_FILE = path.resolve(__dirname, '../outcomes.ndjson');

interface OutcomeRow {
  id: string;
  uri: string;
  curriculum: string;
  source: string;
  subject: string;
  type: string;
  text: string;
}

// Level (schoolLevel/grade) attaches to outcomes via bridge edges, not as tree
// ancestors, so it is not reconstructable by a plain descent; only the subject
// context is tracked here.
function collect(
  node: CurriculumImportAnyNode,
  curriculum: string,
  subject: string,
  rows: OutcomeRow[],
  seen: Set<string>,
): void {
  const nextSubject =
    node.kind === K.SUBJECT ? (node.fields?.title ?? node.ref) : subject;

  if (node.kind === K.LEARNING_OUTCOME) {
    const id = node.externalRef?.externalId ?? node.ref;
    // A shared outcome lives once in the tree; emit it once per curriculum.
    const key = `${curriculum} ${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      const pageId = node.ref?.match(/:page:([^:]+)/)?.[1] ?? '';
      rows.push({
        id,
        uri: outcomeUri(id),
        curriculum,
        source: pageId.startsWith('law-') ? 'riigiteataja' : 'okmv',
        subject,
        type: node.outcomeType ?? '',
        text: (node.fields?.summary ?? '').trim(),
      });
    }
  }
  for (const child of 'children' in node ? (node.children ?? []) : [])
    collect(child, curriculum, nextSubject, rows, seen);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function main(): void {
  const files = fs
    .readdirSync(CURRICULA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const rows: OutcomeRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const curriculum = file.replace(/\.json$/, '');
    const request = JSON.parse(
      fs.readFileSync(path.join(CURRICULA_DIR, file), 'utf-8'),
    ) as CurriculumImportRequest;
    collect(request.root, curriculum, '', rows, seen);
  }

  const columns: (keyof OutcomeRow)[] = [
    'id',
    'uri',
    'curriculum',
    'source',
    'subject',
    'type',
    'text',
  ];
  const csv = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
  fs.writeFileSync(CSV_FILE, `${csv}\n`);
  fs.writeFileSync(NDJSON_FILE, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  console.log(`✅ outcomes.csv + outcomes.ndjson — ${rows.length} outcome rows`);
}

if (require.main === module) main();
