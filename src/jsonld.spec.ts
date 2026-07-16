import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext, buildOutcomesGraph } from './jsonld';

const outcome = (externalId: string, text: string, type: string, curriculum: string) => ({
  externalId,
  text,
  type,
  curriculum,
});

test('buildContext: bridges schema.org and schema.edu.ee', () => {
  const ctx = buildContext()['@context'] as Record<string, unknown>;
  assert.equal(ctx.schema, 'https://schema.org/');
  assert.equal(ctx.edu, 'https://schema.edu.ee/');
  assert.equal(ctx.name, 'schema:name');
});

test('buildOutcomesGraph: types an outcome as DefinedTerm, Opivaljund, and its type class', () => {
  const graph = buildOutcomesGraph([
    outcome('outcome:aaa', 'measure length', 'skill', 'pohikool'),
  ]);
  assert.deepEqual(graph['@graph'][0], {
    id: 'https://curriculum.praktikal.ee/o/aaa',
    type: ['schema:DefinedTerm', 'edu:Opivaljund', 'edu:Oskus'],
    name: 'measure length',
    curriculum: ['pohikool'],
  });
});

test('buildOutcomesGraph: maps each outcome type to its edu.ee class', () => {
  const types = buildOutcomesGraph([
    outcome('outcome:k', 'k', 'knowledge', 'x'),
    outcome('outcome:s', 's', 'skill', 'x'),
    outcome('outcome:a', 'a', 'attitude', 'x'),
    outcome('outcome:c', 'c', 'competence', 'x'),
  ])['@graph'].map((n) => n.type[2]);
  assert.deepEqual(types, ['edu:Hoiak', 'edu:Padevus', 'edu:Teadmine', 'edu:Oskus']);
});

test('buildOutcomesGraph: an outcome with no type gets only the base types', () => {
  const graph = buildOutcomesGraph([
    { externalId: 'outcome:x', text: 'x', curriculum: 'c' },
  ]);
  assert.deepEqual(graph['@graph'][0].type, ['schema:DefinedTerm', 'edu:Opivaljund']);
});

test('buildOutcomesGraph: a shared outcome is one node listing every curriculum', () => {
  const graph = buildOutcomesGraph([
    outcome('outcome:shared', 'shared text', 'knowledge', 'gumnaasium'),
    outcome('outcome:shared', 'shared text', 'knowledge', 'pohikool'),
  ]);
  assert.equal(graph['@graph'].length, 1);
  assert.deepEqual(graph['@graph'][0].curriculum, ['gumnaasium', 'pohikool']);
});

test('buildOutcomesGraph: output is deterministic — graph sorted by id, curricula sorted', () => {
  const graph = buildOutcomesGraph([
    outcome('outcome:zzz', 'z', 'skill', 'pohikool'),
    outcome('outcome:zzz', 'z', 'skill', 'gumnaasium'),
    outcome('outcome:aaa', 'a', 'skill', 'toimetulek'),
  ]);
  assert.deepEqual(
    graph['@graph'].map((n) => n.id),
    ['https://curriculum.praktikal.ee/o/aaa', 'https://curriculum.praktikal.ee/o/zzz'],
  );
  assert.deepEqual(graph['@graph'][1].curriculum, ['gumnaasium', 'pohikool']);
});

test('buildOutcomesGraph: the graph embeds the same context, so the document is self-contained', () => {
  const graph = buildOutcomesGraph([outcome('outcome:a', 'a', 'skill', 'c')]);
  assert.deepEqual(graph['@context'], buildContext()['@context']);
});
