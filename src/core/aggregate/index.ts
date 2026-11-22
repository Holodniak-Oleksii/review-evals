import type { AggregationMethod, Evaluation, TrustScore } from '../types';
import { aggregateLogistic, type Weights } from './logistic';
import { aggregateByRules } from './rules';

export type Aggregator = (evaluation: Pick<Evaluation, 'recommendation' | 'results'>) => TrustScore;

export function createAggregator(method: AggregationMethod, weights?: Weights): Aggregator {
  if (method === 'logistic') {
    if (!weights) throw new Error('Для логістичної регресії потрібен weights.json.');
    return (evaluation) => aggregateLogistic(evaluation, weights);
  }
  return aggregateByRules;
}

export { extractFeatures, type Features } from './features';
export {
  aggregateLogistic,
  parseWeights,
  trainLogistic,
  WEIGHTS_VERSION,
  type TrainingExample,
  type TrainingOptions,
  type TrainingResult,
  type Weights,
} from './logistic';
export { aggregateByRules, GENERATED_FACTOR, MODEL_LIMIT, RULES, VETO_LIMIT } from './rules';
export { HIGH_TRUST, MEDIUM_TRUST, sigmoid, trustLevel } from './trust';
