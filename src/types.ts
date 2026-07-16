// Self-contained schema for the Estonian curriculum data. This package owns its
// own copy of these types (no external dependencies) so it builds standalone.
// The authoritative wire contract is the JSON Schemas under schema/; these
// declarations mirror them for TypeScript consumers.

export enum OutcomeType {
  KNOWLEDGE = 'knowledge',
  SKILL = 'skill',
  ATTITUDE = 'attitude',
  COMPETENCE = 'competence',
}

export enum ContentLanguage {
  de_DE = 'de_DE',
  en_GB = 'en_GB',
  et_EE = 'et_EE',
  ru_RU = 'ru_RU',
  uk_UA = 'uk_UA',
}

// --- Per-page IR (pages/<pageId>.json) ---------------------------------------
// One OKMV source page extracted into a single ordered tree of nodes, in source
// order. Containers (topic/section) hold ordered children; everything else is a
// leaf. `topic` is a browsable/filterable curriculum theme that holds its own
// outcomes and content; `section` is a plain structural heading.

export type ContentNode =
  | { kind: 'topic'; title: string; children: ContentNode[] }
  | { kind: 'section'; title: string; children: ContentNode[] }
  | { kind: 'outcome'; text: string; outcomeType?: OutcomeType }
  | { kind: 'text'; html: string }
  | { kind: 'table'; html: string }
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'file'; src: string; title?: string }
  | { kind: 'link'; href: string; title?: string }
  | { kind: 'video'; src: string }
  | { kind: 'embed'; src: string };

export interface ParseResult {
  content: ContentNode[];
}

export interface ExtractedOutcome {
  text: string;
  type?: OutcomeType;
}

// --- Page tree (tree.json) ----------------------------------------------------
// Lightweight OKMV page hierarchy (ids, titles, parent/child edges) that `merge`
// walks to assemble per-page IR into whole curricula. Carries no source content.

export interface PageInfo {
  id: string;
  title: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
}

// --- Merged curriculum IR (curricula/<curriculum>.json) -----------------------

export enum CurriculumImportNodeKind {
  CURRICULUM = 'curriculum',
  SCHOOL_LEVEL = 'schoolLevel',
  GRADE = 'grade',
  SUBJECT_GROUP = 'subjectGroup',
  SUBJECT = 'subject',
  COURSE = 'course',
  TOPIC = 'topic',
  SECTION = 'section',
  TEXT = 'text',
  TABLE = 'table',
  IMAGE = 'image',
  FILE = 'file',
  LINK = 'link',
  VIDEO = 'video',
  EMBED = 'embed',
  LEARNING_OUTCOME = 'learningOutcome',
  BRIDGE = 'bridge',
}

export enum CurriculumImportBridgeKind {
  SUBJECT_SCHOOL_LEVEL = 'subjectSchoolLevel',
  SUBJECT_GRADE = 'subjectGrade',
}

// Leaf content nodes that can sit inside a section/topic; none have children.
export const CURRICULUM_IMPORT_CONTENT_LEAF_KINDS: readonly CurriculumImportNodeKind[] = [
  CurriculumImportNodeKind.TEXT,
  CurriculumImportNodeKind.TABLE,
  CurriculumImportNodeKind.IMAGE,
  CurriculumImportNodeKind.FILE,
  CurriculumImportNodeKind.LINK,
  CurriculumImportNodeKind.VIDEO,
  CurriculumImportNodeKind.EMBED,
];

// Parent → allowed-child validity for the merged IR. Structural containers hold
// structural children + outcomes; only topic/section hold content leaves.
export const CURRICULUM_IMPORT_ALLOWED_CHILD_KINDS: Record<
  CurriculumImportNodeKind,
  ReadonlySet<CurriculumImportNodeKind>
> = {
  [CurriculumImportNodeKind.CURRICULUM]: new Set([
    CurriculumImportNodeKind.SCHOOL_LEVEL,
    CurriculumImportNodeKind.SUBJECT_GROUP,
    CurriculumImportNodeKind.SUBJECT,
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.SCHOOL_LEVEL]: new Set([
    CurriculumImportNodeKind.GRADE,
    CurriculumImportNodeKind.BRIDGE,
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.GRADE]: new Set([
    CurriculumImportNodeKind.BRIDGE,
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.SUBJECT_GROUP]: new Set([
    CurriculumImportNodeKind.SUBJECT,
    CurriculumImportNodeKind.COURSE,
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.SUBJECT]: new Set([
    CurriculumImportNodeKind.BRIDGE,
    CurriculumImportNodeKind.COURSE,
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.COURSE]: new Set([
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    ...CURRICULUM_IMPORT_CONTENT_LEAF_KINDS,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.BRIDGE]: new Set([
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.TOPIC]: new Set([
    CurriculumImportNodeKind.TOPIC,
    CurriculumImportNodeKind.SECTION,
    ...CURRICULUM_IMPORT_CONTENT_LEAF_KINDS,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.SECTION]: new Set([
    CurriculumImportNodeKind.SECTION,
    ...CURRICULUM_IMPORT_CONTENT_LEAF_KINDS,
    CurriculumImportNodeKind.LEARNING_OUTCOME,
  ]),
  [CurriculumImportNodeKind.TEXT]: new Set(),
  [CurriculumImportNodeKind.TABLE]: new Set(),
  [CurriculumImportNodeKind.IMAGE]: new Set(),
  [CurriculumImportNodeKind.FILE]: new Set(),
  [CurriculumImportNodeKind.LINK]: new Set(),
  [CurriculumImportNodeKind.VIDEO]: new Set(),
  [CurriculumImportNodeKind.EMBED]: new Set(),
  [CurriculumImportNodeKind.LEARNING_OUTCOME]: new Set(),
};

export interface CurriculumImportExternalRef {
  source: string;
  externalId: string;
  url?: string;
}

export interface CurriculumImportFields {
  title?: string;
  summary?: string;
  content?: string;
  language?: ContentLanguage;
  imageUrl?: string;
  externalSrc?: string;
}

interface CurriculumImportNodeBase {
  ref: string;
  fields: CurriculumImportFields;
  externalRef?: CurriculumImportExternalRef;
}

export interface CurriculumImportCurriculumNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.CURRICULUM;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportSchoolLevelNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.SCHOOL_LEVEL;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportGradeNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.GRADE;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportSubjectGroupNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.SUBJECT_GROUP;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportSubjectNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.SUBJECT;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportCourseNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.COURSE;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportTopicNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.TOPIC;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportSectionNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.SECTION;
  children?: CurriculumImportAnyNode[];
}

export interface CurriculumImportTextNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.TEXT;
}

export interface CurriculumImportTableNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.TABLE;
}

export interface CurriculumImportImageNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.IMAGE;
}

export interface CurriculumImportFileNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.FILE;
}

export interface CurriculumImportLinkNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.LINK;
}

export interface CurriculumImportVideoNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.VIDEO;
}

export interface CurriculumImportEmbedNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.EMBED;
}

export interface CurriculumImportLearningOutcomeNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.LEARNING_OUTCOME;
  outcomeType?: OutcomeType;
  // Extra structural parents for a shared outcome that the source repeats across
  // sibling levels; the node lives once and gains an ownership edge per ref.
  secondaryParentRefs?: string[];
}

export interface CurriculumImportBridgeNode extends CurriculumImportNodeBase {
  kind: CurriculumImportNodeKind.BRIDGE;
  bridgeKind: CurriculumImportBridgeKind;
  secondaryParentRef: string;
  children?: CurriculumImportAnyNode[];
}

export type CurriculumImportAnyNode =
  | CurriculumImportCurriculumNode
  | CurriculumImportSchoolLevelNode
  | CurriculumImportGradeNode
  | CurriculumImportSubjectGroupNode
  | CurriculumImportSubjectNode
  | CurriculumImportCourseNode
  | CurriculumImportTopicNode
  | CurriculumImportSectionNode
  | CurriculumImportTextNode
  | CurriculumImportTableNode
  | CurriculumImportImageNode
  | CurriculumImportFileNode
  | CurriculumImportLinkNode
  | CurriculumImportVideoNode
  | CurriculumImportEmbedNode
  | CurriculumImportLearningOutcomeNode
  | CurriculumImportBridgeNode;

export interface CurriculumImportRequest {
  root: CurriculumImportAnyNode;
}
