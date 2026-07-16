import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Validate the published JSON against the schemas. This is the structural gate
// run in CI on every change; the semantic grammar (allowed parent/child kinds)
// is checked separately by `validate`.
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'schema');

function load(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function checkDir(dir: string, validate: ValidateFunction): number {
  let failed = 0;
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const data = load(path.join(dir, file));
    if (!validate(data)) {
      failed++;
      console.error(`  ❌ ${path.basename(dir)}/${file}`);
      for (const err of validate.errors ?? []) {
        console.error(`     ${err.instancePath || '/'} ${err.message}`);
      }
    }
  }
  return failed;
}

function main(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const curriculumV = ajv.compile(load(path.join(SCHEMA_DIR, 'curriculum.schema.json')));
  const pageV = ajv.compile(load(path.join(SCHEMA_DIR, 'page.schema.json')));

  console.log('🔍 Validating curricula/ against curriculum.schema.json...');
  const curriculaFailed = checkDir(path.join(ROOT, 'curricula'), curriculumV);
  console.log('🔍 Validating pages/ against page.schema.json...');
  const pagesFailed = checkDir(path.join(ROOT, 'pages'), pageV);

  const failed = curriculaFailed + pagesFailed;
  if (failed > 0) {
    console.error(`\n❌ schema check failed: ${failed} file(s) invalid`);
    process.exit(1);
  }
  console.log('\n✅ schema check passed — all files conform');
}

if (require.main === module) main();
