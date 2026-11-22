import type { Evaluation } from '../types';

export type Features = Record<string, number>;

const HIGH_SEVERITY = new Set(['bug', 'security']);
const LOW_SEVERITY = new Set(['minor', 'nit']);

export function extractFeatures(evaluation: Pick<Evaluation, 'recommendation' | 'results'>): Features {
  const features: Features = {};
  for (const result of evaluation.results) {
    if (result.status === 'pass') features[`${result.grader}:pass`] = result.score;
    if (result.status === 'fail') features[`${result.grader}:fail`] = 1 - result.score;
  }

  const rec = evaluation.recommendation;
  if (rec.source === 'llm') features['source:llm'] = 1;
  if (rec.suggestionOrigin === 'comment') features['suggestion:comment'] = 1;
  if (rec.suggestionOrigin === 'model') features['suggestion:model'] = 1;
  if (rec.severity && HIGH_SEVERITY.has(rec.severity)) features['severity:high'] = 1;
  if (rec.severity && LOW_SEVERITY.has(rec.severity)) features['severity:low'] = 1;
  return features;
}
