// The canonical outcome identifier scheme. An outcome's permanent id is a
// 16-hex token governed by identifiers.json; this module is the single place
// that turns it into the interoperable forms consumers resolve against.

export const OUTCOME_ID_NAMESPACE = 'ee-curriculum';
export const OUTCOME_EXTERNAL_PREFIX = 'outcome:';
export const OUTCOME_RESOLVER_BASE = 'https://curriculum.praktikal.ee/o/';

export function bareOutcomeId(externalId: string): string {
  return externalId.startsWith(OUTCOME_EXTERNAL_PREFIX)
    ? externalId.slice(OUTCOME_EXTERNAL_PREFIX.length)
    : externalId;
}

export function outcomeUri(id: string): string {
  return `${OUTCOME_RESOLVER_BASE}${bareOutcomeId(id)}`;
}

export function outcomeCurie(id: string): string {
  return `${OUTCOME_ID_NAMESPACE}:o:${bareOutcomeId(id)}`;
}
