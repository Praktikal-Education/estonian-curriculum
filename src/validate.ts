import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CurriculumImportAnyNode, CurriculumImportRequest } from './types';
import {
  CURRICULUM_IMPORT_ALLOWED_CHILD_KINDS,
  CURRICULUM_IMPORT_CONTENT_LEAF_KINDS,
  CurriculumImportNodeKind,
} from './types';

const CURRICULA_DIR = path.resolve(__dirname, '../curricula');

function childrenOf(node: CurriculumImportAnyNode): CurriculumImportAnyNode[] {
  // Only container kinds carry `children`; leaf content and outcomes do not.
  return 'children' in node ? (node.children ?? []) : [];
}

interface ValidationError {
  ref: string;
  path: string;
  message: string;
}

function validate(root: CurriculumImportAnyNode): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenRefs = new Set<string>();

  const walk = (node: CurriculumImportAnyNode, nodePath: string): void => {
    if (seenRefs.has(node.ref)) {
      errors.push({
        ref: node.ref,
        path: nodePath,
        message: `Duplicate ref '${node.ref}'`,
      });
    }
    seenRefs.add(node.ref);

    if (node.kind === CurriculumImportNodeKind.LEARNING_OUTCOME) {
      if (!node.fields?.summary?.trim()) {
        errors.push({
          ref: node.ref,
          path: nodePath,
          message: `Missing summary on learningOutcome node`,
        });
      }
    } else if (
      !node.fields?.title &&
      node.kind !== CurriculumImportNodeKind.SECTION &&
      !CURRICULUM_IMPORT_CONTENT_LEAF_KINDS.includes(node.kind)
    ) {
      errors.push({
        ref: node.ref,
        path: nodePath,
        message: `Missing title on ${node.kind} node`,
      });
    }

    for (const child of childrenOf(node)) {
      if (!CURRICULUM_IMPORT_ALLOWED_CHILD_KINDS[node.kind]?.has(child.kind)) {
        errors.push({
          ref: child.ref,
          path: `${nodePath}/${child.ref}`,
          message: `${child.kind} cannot be a child of ${node.kind}`,
        });
      }
      walk(child, `${nodePath}/${child.ref}`);
    }
  };

  walk(root, root.ref);

  // Bridge secondary parent validation
  const allNodes: CurriculumImportAnyNode[] = [];
  const collect = (n: CurriculumImportAnyNode) => {
    allNodes.push(n);
    childrenOf(n).forEach(collect);
  };
  collect(root);

  for (const node of allNodes) {
    if (node.kind !== CurriculumImportNodeKind.BRIDGE) continue;
    const bridge = node;
    if (bridge.secondaryParentRef === bridge.ref) {
      errors.push({
        ref: bridge.ref,
        path: bridge.ref,
        message: `Bridge secondaryParentRef points at itself`,
      });
    } else if (!seenRefs.has(bridge.secondaryParentRef)) {
      errors.push({
        ref: bridge.ref,
        path: bridge.ref,
        message: `Bridge secondaryParentRef '${bridge.secondaryParentRef}' not found in request`,
      });
    }
  }

  // Shared-outcome secondary parent validation
  for (const node of allNodes) {
    if (node.kind !== CurriculumImportNodeKind.LEARNING_OUTCOME) continue;
    if (!node.secondaryParentRefs?.length) continue;
    for (const parentRef of node.secondaryParentRefs) {
      if (parentRef === node.ref) {
        errors.push({
          ref: node.ref,
          path: node.ref,
          message: `Outcome secondaryParentRefs points at itself`,
        });
      } else if (!seenRefs.has(parentRef)) {
        errors.push({
          ref: node.ref,
          path: node.ref,
          message: `Outcome secondaryParentRefs '${parentRef}' not found in request`,
        });
      }
    }
  }

  return errors;
}

function parseArgs(): { file?: string } {
  const args = process.argv.slice(2);
  if (args.length > 0 && !args[0].startsWith('--')) return { file: args[0] };
  for (const arg of args) {
    if (arg.startsWith('--file=')) return { file: arg.slice('--file='.length) };
  }
  return {};
}

function main() {
  const { file } = parseArgs();

  const files = file
    ? [file]
    : fs
        .readdirSync(CURRICULA_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(CURRICULA_DIR, f));

  for (const filePath of files) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    console.log(`\n🔍 Validating ${path.basename(fullPath)}...`);

    const request = JSON.parse(
      fs.readFileSync(fullPath, 'utf-8'),
    ) as CurriculumImportRequest;

    // Count nodes
    const counts: Record<string, number> = {};
    const countNodes = (n: CurriculumImportAnyNode) => {
      counts[n.kind] = (counts[n.kind] || 0) + 1;
      childrenOf(n).forEach(countNodes);
    };
    countNodes(request.root);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`   ${total} nodes: ${JSON.stringify(counts)}`);

    const errors = validate(request.root);

    if (errors.length === 0) {
      console.log(`   ✅ Valid — no errors`);
    } else {
      console.log(`   ❌ ${errors.length} errors:`);
      errors.slice(0, 20).forEach((e) => console.log(`      ${e.ref}: ${e.message}`));
      if (errors.length > 20) console.log(`      ... +${errors.length - 20} more`);
    }
  }
}

main();
