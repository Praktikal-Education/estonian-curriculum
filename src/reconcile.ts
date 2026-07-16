import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// After a `corrections/` edit changes an outcome's wording, `merge` allocates a
// stray new id for the new text and orphans the old id. This step re-pairs them
// — within the page the correction touched, by text similarity — and records the
// remap in identifiers.json so the outcome keeps its permanent id. It compares
// the committed curricula (git HEAD, the "before") against the freshly-merged
// working tree (the "after"), so run it right after `pnpm merge`.

const CURRICULA_DIR = path.resolve(__dirname, '../curricula');
const IDENTIFIERS_FILE = path.resolve(__dirname, '../identifiers.json');

// A page with a sole edit is remapped even on a modest match (one outcome
// changed there); a page with several orphans/strays needs a stronger match.
const SOLE_EDIT_MIN_SIMILARITY = 0.2;
const MULTI_EDIT_MIN_SIMILARITY = 0.5;

export interface OutcomeOverride {
  fingerprint: string;
  prior: string[];
  status: 'active' | 'deprecated' | 'merged';
  supersededBy?: string;
}

export interface IdentifierLedger {
  version: number;
  allocated: string[];
  overrides: Record<string, OutcomeOverride>;
}

export interface OutcomeRec {
  id: string;
  text: string;
  pageId: string;
}

function normalizeOutcomeKey(summary: string): string {
  return summary
    .replace(/^\s*\d+[).]\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  const s = normalizeOutcomeKey(a);
  const t = normalizeOutcomeKey(b);
  if (!s && !t) return 1;
  const max = Math.max(s.length, t.length);
  if (max === 0) return 1;
  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return 1 - prev[t.length] / max;
}

function collectFromRoot(root: unknown): OutcomeRec[] {
  const recs: OutcomeRec[] = [];
  const walk = (node: any): void => {
    if (node?.kind === 'learningOutcome') {
      const externalId: string | undefined = node.externalRef?.externalId;
      const ref: string = node.ref ?? '';
      const page = ref.match(/page:(\d+)/);
      if (externalId?.startsWith('outcome:')) {
        recs.push({
          id: externalId.slice('outcome:'.length),
          text: node.fields?.summary ?? '',
          pageId: page ? page[1] : '',
        });
      }
    }
    for (const child of node?.children ?? []) walk(child);
  };
  walk(root as any);
  return recs;
}

function curriculaFiles(): string[] {
  return fs.readdirSync(CURRICULA_DIR).filter((f) => f.endsWith('.json'));
}

function loadWorkingTree(): OutcomeRec[] {
  const recs: OutcomeRec[] = [];
  for (const f of curriculaFiles()) {
    const data = JSON.parse(fs.readFileSync(path.join(CURRICULA_DIR, f), 'utf-8'));
    recs.push(...collectFromRoot(data.root));
  }
  return recs;
}

function loadHead(): OutcomeRec[] {
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const recs: OutcomeRec[] = [];
  for (const f of curriculaFiles()) {
    const rel = path.relative(repoRoot, path.join(CURRICULA_DIR, f));
    let raw: string;
    try {
      raw = execSync(`git show HEAD:${rel}`, { maxBuffer: 1 << 28 }).toString();
    } catch {
      continue; // curriculum not present at HEAD (net-new)
    }
    recs.push(...collectFromRoot(JSON.parse(raw).root));
  }
  return recs;
}

function byId(recs: OutcomeRec[]): Map<string, OutcomeRec> {
  const map = new Map<string, OutcomeRec>();
  for (const r of recs) if (!map.has(r.id)) map.set(r.id, r);
  return map;
}

function groupByPage(recs: OutcomeRec[]): Map<string, OutcomeRec[]> {
  const map = new Map<string, OutcomeRec[]>();
  for (const r of recs) {
    const list = map.get(r.pageId);
    if (list) list.push(r);
    else map.set(r.pageId, [r]);
  }
  return map;
}

export interface Remap {
  orphan: OutcomeRec;
  stray: OutcomeRec;
  similarity: number;
}

export function pairPage(orphans: OutcomeRec[], strays: OutcomeRec[]): Remap[] {
  const candidates: Remap[] = [];
  for (const orphan of orphans) {
    for (const stray of strays) {
      candidates.push({ orphan, stray, similarity: similarity(orphan.text, stray.text) });
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity);

  const sole = orphans.length === 1 && strays.length === 1;
  const threshold = sole ? SOLE_EDIT_MIN_SIMILARITY : MULTI_EDIT_MIN_SIMILARITY;

  const usedOrphan = new Set<string>();
  const usedStray = new Set<string>();
  const remaps: Remap[] = [];
  for (const c of candidates) {
    if (usedOrphan.has(c.orphan.id) || usedStray.has(c.stray.id)) continue;
    if (c.similarity < threshold) continue;
    usedOrphan.add(c.orphan.id);
    usedStray.add(c.stray.id);
    remaps.push(c);
  }
  return remaps;
}

export interface ReconciliationPlan {
  remaps: Remap[];
  newOutcomes: OutcomeRec[];
  removedOutcomes: OutcomeRec[];
  ambiguousPages: string[];
}

// Pure: given the outcomes before (git HEAD) and after (this build), work out
// which orphaned ids are corrections of which stray ids, page by page.
export function planReconciliation(
  beforeRecs: OutcomeRec[],
  afterRecs: OutcomeRec[],
): ReconciliationPlan {
  const before = byId(beforeRecs);
  const after = byId(afterRecs);

  const orphans = [...before.values()].filter((r) => !after.has(r.id));
  const strays = [...after.values()].filter((r) => !before.has(r.id));

  const orphansByPage = groupByPage(orphans);
  const straysByPage = groupByPage(strays);

  const remaps: Remap[] = [];
  const ambiguousPages: string[] = [];
  for (const [pageId, pageOrphans] of orphansByPage) {
    const pageStrays = straysByPage.get(pageId) ?? [];
    if (pageStrays.length === 0) continue;
    const paired = pairPage(pageOrphans, pageStrays);
    remaps.push(...paired);
    if (paired.length < Math.min(pageOrphans.length, pageStrays.length)) {
      ambiguousPages.push(pageId);
    }
  }

  const remappedStrays = new Set(remaps.map((r) => r.stray.id));
  const remappedOrphans = new Set(remaps.map((r) => r.orphan.id));
  return {
    remaps,
    newOutcomes: strays.filter((s) => !remappedStrays.has(s.id)),
    removedOutcomes: orphans.filter((o) => !remappedOrphans.has(o.id)),
    ambiguousPages,
  };
}

// Pure: fold the remaps into a new ledger — each orphan id keeps its slot, gains
// an override pointing at the corrected fingerprint with the previous one in
// `prior`, and the stray id it absorbs is dropped from `allocated`.
export function applyRemaps(ledger: IdentifierLedger, remaps: Remap[]): IdentifierLedger {
  const allocated = new Set(ledger.allocated);
  const overrides: Record<string, OutcomeOverride> = { ...(ledger.overrides ?? {}) };
  const currentFingerprint = (id: string): string => overrides[id]?.fingerprint ?? id;

  for (const r of remaps) {
    const prior = new Set(overrides[r.orphan.id]?.prior ?? []);
    prior.add(currentFingerprint(r.orphan.id));
    overrides[r.orphan.id] = {
      fingerprint: r.stray.id,
      prior: [...prior],
      status: overrides[r.orphan.id]?.status ?? 'active',
    };
    allocated.delete(r.stray.id);
  }

  const next: IdentifierLedger = {
    version: ledger.version,
    allocated: [...allocated].sort(),
    overrides: {},
  };
  for (const id of Object.keys(overrides).sort()) next.overrides[id] = overrides[id];
  return next;
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  const plan = planReconciliation(loadHead(), loadWorkingTree());
  const { remaps, newOutcomes, removedOutcomes, ambiguousPages } = plan;

  if (remaps.length === 0 && newOutcomes.length === 0 && removedOutcomes.length === 0) {
    console.log('✅ No orphaned or new outcome ids — nothing to reconcile.');
    return;
  }

  for (const r of remaps) {
    console.log(
      `🔁 page ${r.orphan.pageId}: ${r.orphan.id} keeps id (was "${r.orphan.text.slice(0, 48)}…" ` +
        `→ "${r.stray.text.slice(0, 48)}…", similarity ${r.similarity.toFixed(2)})`,
    );
  }
  for (const s of newOutcomes) {
    console.log(`➕ new outcome ${s.id} on page ${s.pageId} — left as a fresh id`);
  }
  for (const o of removedOutcomes) {
    console.log(
      `➖ outcome ${o.id} on page ${o.pageId} gone with no match — id retained`,
    );
  }
  if (ambiguousPages.length > 0) {
    console.log(
      `⚠️  ${ambiguousPages.length} page(s) had unmatched orphans/strays after pairing ` +
        `(${ambiguousPages.join(', ')}) — review manually.`,
    );
  }

  if (remaps.length === 0) {
    console.log('\nNo confident remaps to apply.');
    return;
  }

  if (dryRun) {
    console.log(
      `\n(dry run) would remap ${remaps.length} outcome id(s); ledger not written.`,
    );
    return;
  }

  const ledger = JSON.parse(
    fs.readFileSync(IDENTIFIERS_FILE, 'utf-8'),
  ) as IdentifierLedger;
  fs.writeFileSync(
    IDENTIFIERS_FILE,
    `${JSON.stringify(applyRemaps(ledger, remaps), null, 2)}\n`,
  );

  console.log(
    `\n✅ Reconciled ${remaps.length} outcome id(s). Run \`pnpm merge\` to rewrite the ` +
      `curricula with the preserved ids, then \`pnpm check:identities\`.`,
  );
}

if (require.main === module) main();
