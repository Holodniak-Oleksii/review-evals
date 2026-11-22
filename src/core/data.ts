import type { Evaluation, GradeResult, Recommendation, TrustScore } from './types';

export const DATA_VERSION = 1;

const DATA_PREFIX = '<!-- review-evals-data ';
const DATA_SUFFIX = ' -->';
const MAX_SUGGESTION = 20_000;

export interface ReplyData {
  version: number;
  recommendation: Omit<Recommendation, 'body'>;
  results: GradeResult[];
  trust?: TrustScore;
}

export function renderData(evaluation: Evaluation): string {
  const { body: _body, ...recommendation } = evaluation.recommendation;
  if (recommendation.suggestion && recommendation.suggestion.length > MAX_SUGGESTION) {
    recommendation.suggestion = recommendation.suggestion.slice(0, MAX_SUGGESTION);
  }
  const data: ReplyData = {
    version: DATA_VERSION,
    recommendation,
    results: evaluation.results,
    ...(evaluation.trust ? { trust: evaluation.trust } : {}),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${DATA_PREFIX}${json}${DATA_SUFFIX}`;
}

export function parseReplyData(body: string | null | undefined): ReplyData | undefined {
  if (!body) return undefined;
  const start = body.indexOf(DATA_PREFIX);
  if (start === -1) return undefined;
  const end = body.indexOf(DATA_SUFFIX, start + DATA_PREFIX.length);
  if (end === -1) return undefined;
  try {
    const data = JSON.parse(body.slice(start + DATA_PREFIX.length, end)) as ReplyData;
    return data.version === DATA_VERSION && Array.isArray(data.results) ? data : undefined;
  } catch {
    return undefined;
  }
}
