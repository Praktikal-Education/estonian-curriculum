import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ContentNode,
  CurriculumImportAnyNode,
  CurriculumImportBridgeNode,
  CurriculumImportLearningOutcomeNode,
  CurriculumImportRequest,
  ExtractedOutcome,
  PageInfo,
  ParseResult,
} from './types';
import {
  ContentLanguage,
  CurriculumImportBridgeKind,
  CurriculumImportNodeKind,
} from './types';

const PAGES_DIR = path.resolve(__dirname, '../pages');
const CORRECTIONS_DIR = path.resolve(__dirname, '../corrections');
const CURRICULA_DIR = path.resolve(__dirname, '../curricula');
const TREE_FILE = path.resolve(__dirname, '../tree.json');
const IDENTIFIERS_FILE = path.resolve(__dirname, '../identifiers.json');

const LANGUAGE = ContentLanguage.et_EE;

// ---------- args ----------

interface MergeArgs {
  root?: string;
  externalSource: string;
  includeSubjectGroups?: Set<string>;
  includeSubjects?: Set<string>;
  frozenIdentities?: boolean;
}

interface BuildOptions {
  includeSubjectGroups?: Set<string>;
  includeSubjects?: Set<string>;
}

let externalRefSource = 'ee-curriculum';

function parseIdSet(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function parseArgs(): MergeArgs {
  const args = process.argv.slice(2);
  const result: MergeArgs = { externalSource: externalRefSource };
  for (const arg of args) {
    if (arg.startsWith('--root=')) result.root = arg.slice('--root='.length);
    if (arg.startsWith('--external-source=')) {
      result.externalSource = arg.slice('--external-source='.length).trim();
    }
    if (arg.startsWith('--include-subject-groups=')) {
      result.includeSubjectGroups = parseIdSet(
        arg.slice('--include-subject-groups='.length),
      );
    }
    if (arg.startsWith('--include-subjects=')) {
      result.includeSubjects = parseIdSet(arg.slice('--include-subjects='.length));
    }
    if (arg === '--frozen-identities') result.frozenIdentities = true;
  }
  if (!result.externalSource) result.externalSource = externalRefSource;
  return result;
}

// ---------- refs ----------

function pageRef(id: string) {
  return `ee-curriculum:page:${id}`;
}

function syntheticRef(kind: string, key: string) {
  return `ee-curriculum:${kind}:${key}`;
}

function extRef(externalId: string) {
  return { source: externalRefSource, externalId };
}

function refExt(ref: string) {
  return extRef(ref.replace(/^ee-curriculum:/, ''));
}

// Video nodes render from `externalSrc` as an embed URL. This mirrors the
// studio editor's normalization (apps/vite/src/nodes/_shared/utils/videoUtils.ts)
// so an imported video node carries the same value a hand-authored one does;
// an unrecognised URL is stored verbatim.
function normalizeVideoSrc(url: string): string {
  const youtubeId = [
    ...url.matchAll(/(youtu.*be.*)\/(watch\?v=|embed\/|v|shorts|)(.*?((?=[&#?])|$))/gim),
  ][0]?.[3];
  if (youtubeId) return `https://www.youtube.com/embed/${youtubeId}`;

  const vimeoId = [
    ...url.matchAll(
      /(vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^/]*)\/videos\/|video\/|)(\d+)(?:|\/\?))/gim,
    ),
  ][0]?.[3];
  if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;

  return url;
}

// ---------- detection ----------

const GRADE_RE = /(\d+)\.?\s*klass/i;
const GRADE_RANGE_RE = /(\d+)\.\s*-\s*(\d+)\.\s*klass/i;
const KOOLIASTE_RE = /^(I{1,3})\s+kooliaste/i;
const SUBJECT_GROUP_RE = /^\d+\.\s*(?:PK|G)\s+(?:Ainevaldkond|Valik)/i;
const PK_SUBJECT_RE = /^PK\s+/;
const G_SUBJECT_RE = /^G\s+/;
const LOK_SUBJECT_RE = /^(?:LÕK|TÕK|HÕK)\s*-?\s*/;
// Leading course designator only: "Kursus …", "Valikkursus", "Paariskursus",
// "I kursus …", "1. kursus …". Not an incidental tail like "… (I–III kursus)".
const COURSE_RE = /^(?:valik|paaris)?kursus\b|^(?:\d+\.?|[IVXL]+)\.?\s+kursus\b/i;

function gradeToKooliaste(grade: number): string {
  if (grade <= 3) return 'I';
  if (grade <= 6) return 'II';
  return 'III';
}

function detectGrade(title: string): number | null {
  const rangeMatch = title.match(GRADE_RANGE_RE);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  const match = title.match(GRADE_RE);
  return match ? parseInt(match[1], 10) : null;
}

function detectKooliaste(title: string): string | null {
  const match = title.match(KOOLIASTE_RE);
  return match ? match[1] : null;
}

function stripSubjectPrefix(title: string): string {
  return title
    .replace(/^(?:PK|G)\s+/, '')
    .replace(/^(?:LÕK|TÕK|HÕK)\s*-?\s*/, '')
    .trim();
}

// ---------- page loading ----------

// The page hierarchy (ids, titles, parent/child edges) ships as tree.json — a
// flat array of PageInfo carrying no source content. `merge` walks it to
// assemble the per-page IR into whole curricula.
function loadPages(): Map<string, PageInfo> {
  const tree = JSON.parse(fs.readFileSync(TREE_FILE, 'utf-8')) as PageInfo[];
  const pages = new Map<string, PageInfo>();
  for (const p of tree) pages.set(p.id, p);
  return pages;
}

function loadExtraction(pageId: string): ParseResult | null {
  // A community correction, if present, overrides the generated page.
  const correction = path.join(CORRECTIONS_DIR, `${pageId}.json`);
  const fp = fs.existsSync(correction)
    ? correction
    : path.join(PAGES_DIR, `${pageId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as ParseResult;
}

// ---------- content builders ----------

function outcomeToNode(outcome: ExtractedOutcome, ref: string): CurriculumImportAnyNode {
  return {
    ref,
    kind: CurriculumImportNodeKind.LEARNING_OUTCOME as const,
    fields: { summary: outcome.text.trim(), language: LANGUAGE },
    externalRef: outcomeContentRef(outcome.text, outcome.type),
    ...(outcome.type ? { outcomeType: outcome.type } : {}),
  };
}

// A leaf content node (everything except the topic/section containers) maps to
// its own import node so it renders through the right component. Returns null
// when the node carries no usable value.
function leafToNode(node: ContentNode, ref: string): CurriculumImportAnyNode | null {
  const wrap = (
    kind: CurriculumImportNodeKind,
    fields: CurriculumImportAnyNode['fields'],
  ): CurriculumImportAnyNode =>
    ({
      ref,
      kind,
      fields: { language: LANGUAGE, ...fields },
      externalRef: refExt(ref),
    }) as CurriculumImportAnyNode;

  switch (node.kind) {
    case 'outcome':
      return node.text?.trim()
        ? outcomeToNode({ text: node.text.trim(), type: node.outcomeType }, ref)
        : null;
    case 'text':
      return node.html?.trim()
        ? wrap(CurriculumImportNodeKind.TEXT, { title: '', content: node.html.trim() })
        : null;
    case 'table':
      return node.html?.trim()
        ? wrap(CurriculumImportNodeKind.TABLE, { content: node.html.trim() })
        : null;
    case 'image':
      return node.src?.trim()
        ? wrap(CurriculumImportNodeKind.IMAGE, {
            imageUrl: node.src.trim(),
            ...(node.alt ? { summary: node.alt } : {}),
          })
        : null;
    case 'file':
      return node.src?.trim()
        ? wrap(CurriculumImportNodeKind.FILE, {
            externalSrc: node.src.trim(),
            ...(node.title ? { title: node.title } : {}),
          })
        : null;
    case 'link':
      return node.href?.trim()
        ? wrap(CurriculumImportNodeKind.LINK, {
            externalSrc: node.href.trim(),
            ...(node.title ? { title: node.title } : {}),
          })
        : null;
    case 'video':
      return node.src?.trim()
        ? wrap(CurriculumImportNodeKind.VIDEO, {
            externalSrc: normalizeVideoSrc(node.src.trim()),
          })
        : null;
    case 'embed':
      return node.src?.trim()
        ? wrap(CurriculumImportNodeKind.EMBED, { externalSrc: node.src.trim() })
        : null;
    case 'generalCompetency':
      return node.title?.trim()
        ? wrap(CurriculumImportNodeKind.GENERAL_COMPETENCY, {
            title: node.title.trim(),
            ...(node.description?.trim() ? { summary: node.description.trim() } : {}),
          })
        : null;
    default:
      return null;
  }
}

// Recursively map one content node to an import node: `topic`/`section` become
// container nodes whose children are the ordered mapping of their own children;
// leaves defer to leafToNode. Position is the structure — nothing is reordered.
function contentNodeToImport(
  node: ContentNode,
  ref: string,
): CurriculumImportAnyNode | null {
  if (node.kind === 'topic' || node.kind === 'section') {
    const children = buildChildren(node.children ?? [], ref);
    return {
      ref,
      kind:
        node.kind === 'topic'
          ? CurriculumImportNodeKind.TOPIC
          : CurriculumImportNodeKind.SECTION,
      fields: { title: node.title, language: LANGUAGE },
      externalRef: refExt(ref),
      ...(children.length > 0 ? { children } : {}),
    } as CurriculumImportAnyNode;
  }
  return leafToNode(node, ref);
}

function buildChildren(
  nodes: ContentNode[],
  refPrefix: string,
): CurriculumImportAnyNode[] {
  const consumed = new Set<number>();
  const out: CurriculumImportAnyNode[] = [];

  nodes.forEach((n, i) => {
    if (consumed.has(i)) return;

    // A general competency is authored as a heading followed by a paragraph of
    // prose; fold that paragraph onto the competency as its description so it
    // renders as one box, and drop the now-consumed sibling text.
    let node = n;
    if (n.kind === 'generalCompetency') {
      const next = nodes[i + 1];
      if (next?.kind === 'text' && next.html?.trim()) {
        node = { ...n, description: next.html.trim() };
        consumed.add(i + 1);
      }
    }

    const mapped = contentNodeToImport(node, `${refPrefix}:${i}`);
    if (mapped != null) out.push(mapped);
  });

  return out;
}

function buildContentNodes(pageId: string): CurriculumImportAnyNode[] {
  const extraction = loadExtraction(pageId);
  if (!extraction) return [];
  return buildChildren(extraction.content ?? [], pageRef(pageId));
}

function buildPageNode(
  pageId: string,
  pages: Map<string, PageInfo>,
  kind: CurriculumImportNodeKind.TOPIC | CurriculumImportNodeKind.COURSE,
): CurriculumImportAnyNode {
  const page = pages.get(pageId)!;
  const children = buildContentNodes(pageId);

  for (const childId of page.childIds) {
    if (pages.has(childId)) {
      children.push(buildTopicFromPage(childId, pages));
    }
  }

  return {
    ref: pageRef(pageId),
    kind,
    fields: { title: page.title, language: LANGUAGE },
    externalRef: extRef(`page:${pageId}`),
    ...(children.length > 0 ? { children } : {}),
  };
}

function buildTopicFromPage(
  pageId: string,
  pages: Map<string, PageInfo>,
): CurriculumImportAnyNode {
  return buildPageNode(pageId, pages, CurriculumImportNodeKind.TOPIC);
}

// A gümnaasium subject-child is a course when its title carries a course
// designator; otherwise it is a content topic (KUULAMINE, LUGEMINE, …).
function buildSubjectChildFromPage(
  pageId: string,
  pages: Map<string, PageInfo>,
): CurriculumImportAnyNode {
  const page = pages.get(pageId);
  return page && COURSE_RE.test(page.title)
    ? buildPageNode(pageId, pages, CurriculumImportNodeKind.COURSE)
    : buildTopicFromPage(pageId, pages);
}

// ---------- grade/bridge builder ----------

function buildGradeBridges(
  subjectTitle: string,
  childPages: PageInfo[],
  pages: Map<string, PageInfo>,
  allGrades: Set<number>,
  allKooliastmed: Set<string>,
): { bridges: CurriculumImportAnyNode[]; other: CurriculumImportAnyNode[] } {
  const bridges: CurriculumImportAnyNode[] = [];
  const other: CurriculumImportAnyNode[] = [];

  for (const childPage of childPages) {
    const kooliaste = detectKooliaste(childPage.title);
    const grade = detectGrade(childPage.title);

    if (kooliaste) {
      allKooliastmed.add(kooliaste);
      const bridgeChildren = buildContentNodes(childPage.id);
      // The kooliaste overview must precede its grades in sibling order, so
      // grade bridges are collected first and pushed after it.
      const gradeBridges: CurriculumImportAnyNode[] = [];
      for (const gradePageId of childPage.childIds) {
        const gradePage = pages.get(gradePageId);
        if (!gradePage) continue;

        const childGrade = detectGrade(gradePage.title);
        if (childGrade !== null) {
          allGrades.add(childGrade);
          const gradeBridgeChildren = buildContentNodes(gradePage.id);
          for (const gcId of gradePage.childIds) {
            if (pages.has(gcId))
              gradeBridgeChildren.push(buildTopicFromPage(gcId, pages));
          }
          gradeBridges.push({
            ref: `${pageRef(gradePage.id)}:bridge`,
            kind: CurriculumImportNodeKind.BRIDGE,
            bridgeKind: CurriculumImportBridgeKind.SUBJECT_GRADE,
            secondaryParentRef: syntheticRef('grade', String(childGrade)),
            fields: {
              title: `${subjectTitle} – ${childGrade}. klass`,
              language: LANGUAGE,
            },
            externalRef: extRef(`page:${gradePage.id}`),
            children: gradeBridgeChildren,
          } as CurriculumImportBridgeNode);
        } else {
          bridgeChildren.push(buildTopicFromPage(gradePage.id, pages));
        }
      }
      bridges.push({
        ref: `${pageRef(childPage.id)}:bridge`,
        kind: CurriculumImportNodeKind.BRIDGE,
        bridgeKind: CurriculumImportBridgeKind.SUBJECT_SCHOOL_LEVEL,
        secondaryParentRef: syntheticRef('schoolLevel', kooliaste),
        fields: { title: `${subjectTitle} – ${kooliaste} kooliaste`, language: LANGUAGE },
        externalRef: extRef(`page:${childPage.id}`),
        children: bridgeChildren,
      } as CurriculumImportBridgeNode);
      bridges.push(...gradeBridges);
    } else if (grade !== null) {
      // Grade page directly under subject
      allGrades.add(grade);
      const bridgeChildren = buildContentNodes(childPage.id);
      for (const gcId of childPage.childIds) {
        if (pages.has(gcId)) bridgeChildren.push(buildTopicFromPage(gcId, pages));
      }
      bridges.push({
        ref: `${pageRef(childPage.id)}:bridge`,
        kind: CurriculumImportNodeKind.BRIDGE,
        bridgeKind: CurriculumImportBridgeKind.SUBJECT_GRADE,
        secondaryParentRef: syntheticRef('grade', String(grade)),
        fields: { title: `${subjectTitle} – ${grade}. klass`, language: LANGUAGE },
        externalRef: extRef(`page:${childPage.id}`),
        children: bridgeChildren,
      } as CurriculumImportBridgeNode);
    } else {
      other.push(buildTopicFromPage(childPage.id, pages));
    }
  }

  return { bridges, other };
}

// ---------- Põhikool builder ----------

function buildPohikool(
  rootPageId: string,
  pages: Map<string, PageInfo>,
  options: BuildOptions = {},
): CurriculumImportAnyNode {
  const rootPage = pages.get(rootPageId)!;
  const allGrades = new Set<number>();
  const allKooliastmed = new Set<string>();
  const topLevelChildren: CurriculumImportAnyNode[] = [];

  topLevelChildren.push(...buildContentNodes(rootPageId));

  for (const sgPageId of rootPage.childIds) {
    if (options.includeSubjectGroups && !options.includeSubjectGroups.has(sgPageId)) {
      continue;
    }

    const sgPage = pages.get(sgPageId);
    if (!sgPage) continue;

    if (!SUBJECT_GROUP_RE.test(sgPage.title)) {
      topLevelChildren.push(buildTopicFromPage(sgPageId, pages));
      continue;
    }

    const sgTitle = sgPage.title
      .replace(/^\d+\.\s*(?:PK|G)\s+(?:Ainevaldkond\s+)?/, '')
      .replace(/[„“”«»"]/g, '')
      .trim();

    const subjectNodes: CurriculumImportAnyNode[] = [];
    const sgContent = buildContentNodes(sgPageId);

    const subjectChildren = sgPage.childIds
      .map((id) => pages.get(id))
      .filter(Boolean) as PageInfo[];
    const hasNamedSubjects = subjectChildren.some((c) => PK_SUBJECT_RE.test(c.title));

    if (hasNamedSubjects) {
      for (const childPage of subjectChildren) {
        if (PK_SUBJECT_RE.test(childPage.title)) {
          if (options.includeSubjects && !options.includeSubjects.has(childPage.id)) {
            continue;
          }

          const subjectTitle = stripSubjectPrefix(childPage.title);
          const grandchildren = childPage.childIds
            .map((id) => pages.get(id))
            .filter(Boolean) as PageInfo[];
          const { bridges, other } = buildGradeBridges(
            subjectTitle,
            grandchildren,
            pages,
            allGrades,
            allKooliastmed,
          );
          const subjectContent = buildContentNodes(childPage.id);

          subjectNodes.push({
            ref: pageRef(childPage.id),
            kind: CurriculumImportNodeKind.SUBJECT,
            fields: { title: subjectTitle, language: LANGUAGE },
            externalRef: extRef(`page:${childPage.id}`),
            children: [...subjectContent, ...other, ...bridges],
          });
        } else {
          sgContent.push(buildTopicFromPage(childPage.id, pages));
        }
      }
    } else {
      // No named subjects — grade pages directly under subject group (Matemaatika)
      const { bridges, other } = buildGradeBridges(
        sgTitle,
        subjectChildren,
        pages,
        allGrades,
        allKooliastmed,
      );
      if (bridges.length > 0) {
        subjectNodes.push({
          ref: syntheticRef('subject', sgTitle.toLowerCase().replace(/\s+/g, '-')),
          kind: CurriculumImportNodeKind.SUBJECT,
          fields: { title: sgTitle, language: LANGUAGE },
          externalRef: extRef(`subjectGroup:${sgPageId}:subject`),
          children: [...sgContent, ...other, ...bridges],
        });
      } else {
        subjectNodes.push(...other);
        if (sgContent.length > 0) subjectNodes.unshift(...sgContent);
      }
    }

    topLevelChildren.push({
      ref: pageRef(sgPageId),
      kind: CurriculumImportNodeKind.SUBJECT_GROUP,
      fields: { title: sgTitle, language: LANGUAGE },
      externalRef: extRef(`page:${sgPageId}`),
      children: hasNamedSubjects ? [...sgContent, ...subjectNodes] : subjectNodes,
    });
  }

  const schoolLevelNodes = buildSchoolLevels(
    allGrades,
    allKooliastmed,
    `page:${rootPageId}`,
  );
  if (schoolLevelNodes.length > 0) {
    const firstSgIdx = topLevelChildren.findIndex(
      (c) => c.kind === CurriculumImportNodeKind.SUBJECT_GROUP,
    );
    topLevelChildren.splice(
      firstSgIdx >= 0 ? firstSgIdx : topLevelChildren.length,
      0,
      ...schoolLevelNodes,
    );
  }

  return {
    ref: pageRef(rootPageId),
    kind: CurriculumImportNodeKind.CURRICULUM,
    fields: { title: rootPage.title, language: LANGUAGE },
    externalRef: extRef(`page:${rootPageId}`),
    children: topLevelChildren,
  };
}

// ---------- Gümnaasium builder ----------

function buildGumnaasium(
  rootPageId: string,
  pages: Map<string, PageInfo>,
): CurriculumImportAnyNode {
  const rootPage = pages.get(rootPageId)!;
  const topLevelChildren: CurriculumImportAnyNode[] = [];

  topLevelChildren.push(...buildContentNodes(rootPageId));

  for (const sgPageId of rootPage.childIds) {
    const sgPage = pages.get(sgPageId);
    if (!sgPage) continue;

    const isSubjectGroup = /Ainevaldkond|Valik/i.test(sgPage.title);
    if (!isSubjectGroup) {
      topLevelChildren.push(buildTopicFromPage(sgPageId, pages));
      continue;
    }

    const sgTitle = sgPage.title
      .replace(/^G\s+(?:Ainevaldkond\s+)?/, '')
      .replace(/[„“”«»"]/g, '')
      .trim();

    const subjectNodes: CurriculumImportAnyNode[] = [];
    const sgContent = buildContentNodes(sgPageId);
    const subjectChildren = sgPage.childIds
      .map((id) => pages.get(id))
      .filter(Boolean) as PageInfo[];
    const hasNamedSubjects = subjectChildren.some(
      (c) => G_SUBJECT_RE.test(c.title) || /^(?:Kitsas|Lai)\s/i.test(c.title),
    );

    if (hasNamedSubjects) {
      for (const childPage of subjectChildren) {
        if (
          G_SUBJECT_RE.test(childPage.title) ||
          /^(?:Kitsas|Lai)\s/i.test(childPage.title)
        ) {
          const subjectTitle = stripSubjectPrefix(childPage.title);
          const subjectContent = buildContentNodes(childPage.id);
          const courseNodes: CurriculumImportAnyNode[] = [];
          for (const kursusId of childPage.childIds) {
            if (pages.has(kursusId)) {
              courseNodes.push(buildSubjectChildFromPage(kursusId, pages));
            }
          }
          subjectNodes.push({
            ref: pageRef(childPage.id),
            kind: CurriculumImportNodeKind.SUBJECT,
            fields: { title: subjectTitle, language: LANGUAGE },
            externalRef: extRef(`page:${childPage.id}`),
            children: [...subjectContent, ...courseNodes],
          });
        } else {
          sgContent.push(buildTopicFromPage(childPage.id, pages));
        }
      }
    } else {
      // All children are courses or content directly
      for (const childPage of subjectChildren) {
        subjectNodes.push(buildSubjectChildFromPage(childPage.id, pages));
      }
    }

    topLevelChildren.push({
      ref: pageRef(sgPageId),
      kind: CurriculumImportNodeKind.SUBJECT_GROUP,
      fields: { title: sgTitle, language: LANGUAGE },
      externalRef: extRef(`page:${sgPageId}`),
      children: [...sgContent, ...subjectNodes],
    });
  }

  return {
    ref: pageRef(rootPageId),
    kind: CurriculumImportNodeKind.CURRICULUM,
    fields: { title: rootPage.title, language: LANGUAGE },
    externalRef: extRef(`page:${rootPageId}`),
    children: topLevelChildren,
  };
}

// ---------- Lihtsustatud track builder ----------

// The simplified national curriculum bundles three independent programs
// (Lihtsustatud õpe / Toimetulekuõpe / Hooldusõpe), each with its own grade span
// and subject set and no outcomes shared between them. Each becomes its own
// curriculum; the shared statute is recorded as the curriculum summary so the
// legal lineage stays queryable without a synthetic wrapper node.
const LIHTSUSTATUD_REGULATION = 'Põhikooli lihtsustatud riiklik õppekava';

function buildLihtsustatudTrack(
  trackPageId: string,
  pages: Map<string, PageInfo>,
): CurriculumImportAnyNode {
  const trackPage = pages.get(trackPageId)!;
  const allGrades = new Set<number>();
  const allKooliastmed = new Set<string>();
  const topLevelChildren: CurriculumImportAnyNode[] = [];

  topLevelChildren.push(...buildContentNodes(trackPageId));

  for (const subPageId of trackPage.childIds) {
    const subPage = pages.get(subPageId);
    if (!subPage) continue;

    const isLokSubject = LOK_SUBJECT_RE.test(subPage.title);
    if (!isLokSubject) {
      // Non-subject child (üldosa, etc.) → topic directly under the curriculum
      topLevelChildren.push(buildTopicFromPage(subPageId, pages));
      continue;
    }

    const subjectTitle = stripSubjectPrefix(subPage.title);
    const subjectContent = buildContentNodes(subPageId);
    const grandchildren = subPage.childIds
      .map((id) => pages.get(id))
      .filter(Boolean) as PageInfo[];

    // Check if this subject has kooliaste/grade children
    const hasStructure = grandchildren.some(
      (c) => detectKooliaste(c.title) !== null || detectGrade(c.title) !== null,
    );

    if (hasStructure) {
      const { bridges, other } = buildGradeBridges(
        subjectTitle,
        grandchildren,
        pages,
        allGrades,
        allKooliastmed,
      );
      topLevelChildren.push({
        ref: pageRef(subPageId),
        kind: CurriculumImportNodeKind.SUBJECT,
        fields: { title: subjectTitle, language: LANGUAGE },
        externalRef: extRef(`page:${subPageId}`),
        children: [...subjectContent, ...other, ...bridges],
      });
    } else {
      // No grade structure (TÕK subjects — single big pages)
      const childTopics = grandchildren.map((c) => buildTopicFromPage(c.id, pages));
      topLevelChildren.push({
        ref: pageRef(subPageId),
        kind: CurriculumImportNodeKind.SUBJECT,
        fields: { title: subjectTitle, language: LANGUAGE },
        externalRef: extRef(`page:${subPageId}`),
        children: [...subjectContent, ...childTopics],
      });
    }
  }

  const schoolLevelNodes = buildSchoolLevels(
    allGrades,
    allKooliastmed,
    `page:${trackPageId}`,
  );
  if (schoolLevelNodes.length > 0) {
    const firstSubjectIdx = topLevelChildren.findIndex(
      (c) => c.kind === CurriculumImportNodeKind.SUBJECT,
    );
    topLevelChildren.splice(
      firstSubjectIdx >= 0 ? firstSubjectIdx : topLevelChildren.length,
      0,
      ...schoolLevelNodes,
    );
  }

  return {
    ref: pageRef(trackPageId),
    kind: CurriculumImportNodeKind.CURRICULUM,
    fields: {
      title: trackPage.title,
      summary: LIHTSUSTATUD_REGULATION,
      language: LANGUAGE,
    },
    externalRef: extRef(`page:${trackPageId}`),
    children: topLevelChildren,
  };
}

// ---------- school level builder ----------

const KOOLIASTE_ORDER = ['I', 'II', 'III'];

function buildSchoolLevels(
  allGrades: Set<number>,
  allKooliastmed: Set<string>,
  scope: string,
): CurriculumImportAnyNode[] {
  const kooliasteMap = new Map<string, number[]>();
  for (const ka of allKooliastmed) {
    if (!kooliasteMap.has(ka)) kooliasteMap.set(ka, []);
  }
  for (const g of [...allGrades].sort((a, b) => a - b)) {
    const ka = gradeToKooliaste(g);
    if (!kooliasteMap.has(ka)) kooliasteMap.set(ka, []);
    kooliasteMap.get(ka)!.push(g);
  }

  const orderedKa = [...kooliasteMap.keys()].sort(
    (a, b) => KOOLIASTE_ORDER.indexOf(a) - KOOLIASTE_ORDER.indexOf(b),
  );

  const nodes: CurriculumImportAnyNode[] = [];
  for (const ka of orderedKa) {
    const grades = kooliasteMap.get(ka)!;
    nodes.push({
      ref: syntheticRef('schoolLevel', ka),
      kind: CurriculumImportNodeKind.SCHOOL_LEVEL,
      fields: { title: `${ka} kooliaste`, language: LANGUAGE },
      externalRef: extRef(`${scope}:schoolLevel:${ka}`),
      children: grades.map((g) => ({
        ref: syntheticRef('grade', String(g)),
        kind: CurriculumImportNodeKind.GRADE,
        fields: { title: `${g}. klass`, language: LANGUAGE },
        externalRef: extRef(`${scope}:grade:${g}`),
      })),
    });
  }

  return nodes;
}

// ---------- outcome dedup + shared identity ----------

// An outcome's content identity: its text with leading numbering and
// punctuation stripped, plus its type. The source repeats identical õpitulemused
// across levels (a kooliaste's outcomes copied onto each grade) and across the
// parallel keel curricula (Eesti/Vene keel share verbatim outcomes); identical
// text + type is treated as one learning outcome. Subject is deliberately NOT
// part of the key so the same node reused across curricula stays name-agnostic
// (PK vs G Füüsika); the measured cross-subject false-merge rate is ~0.
function normalizeOutcomeKey(summary: string): string {
  return summary
    .replace(/^\s*\d+[).]\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function outcomeIdentity(node: CurriculumImportLearningOutcomeNode): string | null {
  const text = normalizeOutcomeKey(node.fields.summary ?? '');
  return text ? `${text}|${node.outcomeType ?? ''}` : null;
}

// An id whose current text still hashes to itself, with no prior fingerprints
// and active status, is the default and lives only in `allocated`. An outcome
// that deviates from that — a wording correction (fingerprint ≠ id, old hashes
// in `prior`) or a deprecation/merge — gets an explicit `overrides` entry.
interface OutcomeOverride {
  fingerprint: string;
  prior: string[];
  status: 'active' | 'deprecated' | 'merged';
  supersededBy?: string;
}

interface IdentifierLedger {
  version: number;
  allocated: string[];
  overrides: Record<string, OutcomeOverride>;
}

let allocatedIdSet = new Set<string>();
let overrides: Record<string, OutcomeOverride> = {};
let fingerprintToId = new Map<string, string>();
let frozenIdentities = false;
let ledgerDirty = false;
let ledgerExisted = false;
const allocatedIds: string[] = [];
let reusedCount = 0;

// The content fingerprint identifies an outcome by its normalized text + type.
// Identical outcomes across curricula share a fingerprint (deliberate dedup).
function outcomeFingerprint(summary: string, type?: string): string {
  const key = `${normalizeOutcomeKey(summary)}|${type ?? ''}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function loadLedger(): void {
  let ledger: IdentifierLedger = { version: 1, allocated: [], overrides: {} };
  if (fs.existsSync(IDENTIFIERS_FILE)) {
    ledgerExisted = true;
    ledger = JSON.parse(fs.readFileSync(IDENTIFIERS_FILE, 'utf-8')) as IdentifierLedger;
  }
  allocatedIdSet = new Set(ledger.allocated);
  overrides = ledger.overrides ?? {};
  fingerprintToId = new Map();
  // Current fingerprint of each id: an override's declared one, else the id
  // itself (default). Currents are mapped first so they win over any prior.
  for (const id of allocatedIdSet) {
    fingerprintToId.set(overrides[id]?.fingerprint ?? id, id);
  }
  // Prior fingerprints resolve too, so a reverted correction reattaches its id.
  for (const [id, rec] of Object.entries(overrides)) {
    for (const p of rec.prior) if (!fingerprintToId.has(p)) fingerprintToId.set(p, id);
  }
}

function saveLedger(): void {
  if (!ledgerDirty) return;
  const ledger: IdentifierLedger = {
    version: 1,
    allocated: [...allocatedIdSet].sort(),
    overrides: {},
  };
  for (const id of Object.keys(overrides).sort()) ledger.overrides[id] = overrides[id];
  fs.writeFileSync(IDENTIFIERS_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
}

// Resolve a content fingerprint to its permanent outcome id. Known fingerprints
// (current or prior) reuse their id; a new fingerprint is allocated an id seeded
// from itself and recorded in the ledger. Corrections keep an outcome's id by a
// maintainer moving the old fingerprint into that id's `overrides.prior` (see
// corrections/README.md) — the build never rewrites existing entries.
function resolveOutcomeId(fingerprint: string): string {
  const existing = fingerprintToId.get(fingerprint);
  if (existing) {
    reusedCount++;
    return existing;
  }
  if (frozenIdentities) {
    throw new Error(
      `Unknown outcome fingerprint ${fingerprint} with --frozen-identities. ` +
        `An outcome's text changed without a ledger update; reconcile identifiers.json first.`,
    );
  }
  allocatedIdSet.add(fingerprint);
  fingerprintToId.set(fingerprint, fingerprint);
  allocatedIds.push(fingerprint);
  ledgerDirty = true;
  return fingerprint;
}

// Stable externalRef keyed by the outcome's permanent, ledger-governed id so
// identical outcomes resolve to the same node across curriculum imports and
// survive text corrections. Distinct from the positional page refs used by
// structural/content nodes.
function outcomeContentRef(summary: string, type?: string) {
  const id = resolveOutcomeId(outcomeFingerprint(summary, type));
  return { source: externalRefSource, externalId: `outcome:${id}` };
}

interface OutcomeOccurrence {
  node: CurriculumImportLearningOutcomeNode;
  parent: CurriculumImportAnyNode;
}

function collectOutcomeOccurrences(
  node: CurriculumImportAnyNode,
  acc: OutcomeOccurrence[],
): void {
  if (!('children' in node) || !node.children) return;
  for (const child of node.children) {
    if (child.kind === CurriculumImportNodeKind.LEARNING_OUTCOME) {
      acc.push({ node: child, parent: node });
    }
    collectOutcomeOccurrences(child, acc);
  }
}

// Collapse identical outcomes across the whole curriculum into one shared node
// owned by every level/subject that lists it. The first pre-order occurrence
// stays canonical; each other occurrence's parent becomes a secondary parent.
function dedupeOutcomes(root: CurriculumImportAnyNode): number {
  const occurrences: OutcomeOccurrence[] = [];
  collectOutcomeOccurrences(root, occurrences);

  const groups = new Map<string, OutcomeOccurrence[]>();
  for (const occ of occurrences) {
    const key = outcomeIdentity(occ.node);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(occ);
    else groups.set(key, [occ]);
  }

  const toRemove = new Set<CurriculumImportAnyNode>();
  let collapsed = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [canonical, ...dups] = list;
    const secondary = new Set(canonical.node.secondaryParentRefs ?? []);
    for (const dup of dups) {
      if (dup.parent.ref !== canonical.parent.ref) secondary.add(dup.parent.ref);
      toRemove.add(dup.node);
      collapsed++;
    }
    secondary.delete(canonical.parent.ref);
    if (secondary.size > 0) canonical.node.secondaryParentRefs = [...secondary];
  }

  const prune = (node: CurriculumImportAnyNode): void => {
    if (!('children' in node) || !node.children) return;
    node.children = node.children.filter((c) => !toRemove.has(c));
    node.children.forEach(prune);
  };
  prune(root);

  return collapsed;
}

// ---------- roots ----------

const ROOTS: Record<string, { pageId: string; title: string; builder: string }> = {
  pohikool: {
    pageId: '211453475',
    title: 'Põhikooli riiklik õppekava',
    builder: 'pohikool',
  },
  gumnaasium: {
    pageId: '211453978',
    title: 'Gümnaasiumi riiklik õppekava',
    builder: 'gumnaasium',
  },
  // The simplified national curriculum is split into its three independent
  // tracks, each imported as its own curriculum (see buildLihtsustatudTrack).
  lihtsustatud: {
    pageId: '212839958',
    title: 'Lihtsustatud õpe',
    builder: 'lihtsustatudTrack',
  },
  toimetulek: {
    pageId: '212839963',
    title: 'Toimetulekuõpe',
    builder: 'lihtsustatudTrack',
  },
  hooldus: {
    pageId: '212839965',
    title: 'Hooldusõpe',
    builder: 'lihtsustatudTrack',
  },
};

function main() {
  fs.mkdirSync(CURRICULA_DIR, { recursive: true });
  const {
    root: rootFilter,
    externalSource,
    includeSubjectGroups,
    includeSubjects,
    frozenIdentities: frozen,
  } = parseArgs();
  externalRefSource = externalSource;
  frozenIdentities = frozen ?? false;
  loadLedger();
  const pages = loadPages();

  const builders: Record<
    string,
    (
      id: string,
      p: Map<string, PageInfo>,
      options?: BuildOptions,
    ) => CurriculumImportAnyNode
  > = {
    pohikool: buildPohikool,
    gumnaasium: buildGumnaasium,
    lihtsustatudTrack: buildLihtsustatudTrack,
  };

  const rootKeys = rootFilter ? [rootFilter] : Object.keys(ROOTS);

  for (const key of rootKeys) {
    const rootDef = ROOTS[key];
    if (!rootDef) {
      console.error(`Unknown root: ${key}`);
      continue;
    }

    if (!pages.has(rootDef.pageId)) {
      console.warn(`⚠️  Skipping ${key}: root page ${rootDef.pageId} not in tree.json`);
      continue;
    }

    console.log(`\n📦 Building ${rootDef.title}...`);
    const root = builders[rootDef.builder](rootDef.pageId, pages, {
      includeSubjectGroups,
      includeSubjects,
    });

    const collapsed = dedupeOutcomes(root);
    if (collapsed > 0) {
      console.log(`   🔗 collapsed ${collapsed} duplicate outcome(s) into shared nodes`);
    }

    const request: CurriculumImportRequest = { root };

    const counts: Record<string, number> = {};
    const countNodes = (node: CurriculumImportAnyNode) => {
      counts[node.kind] = (counts[node.kind] || 0) + 1;
      if ('children' in node && node.children) {
        for (const child of node.children) countNodes(child);
      }
    };
    countNodes(root);

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const outPath = path.join(CURRICULA_DIR, `${key}.json`);
    fs.writeFileSync(outPath, JSON.stringify(request, null, 2));
    console.log(`✅ ${outPath} — ${total} nodes`);
    console.log(`   ${JSON.stringify(counts)}`);
  }

  saveLedger();
  console.log(
    `\n🔑 outcome ids: ${reusedCount} reused, ${allocatedIds.length} newly allocated ` +
      `(ledger: ${allocatedIdSet.size} total)`,
  );
  if (allocatedIds.length > 0 && ledgerExisted) {
    const sample = allocatedIds.slice(0, 10).join(', ');
    console.log(
      `   ⚠️  new ids on an existing ledger (a correction or genuinely new outcome): ` +
        `${sample}${allocatedIds.length > 10 ? `, +${allocatedIds.length - 10} more` : ''}`,
    );
  }
}

main();
