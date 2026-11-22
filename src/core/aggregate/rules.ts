import type { Evaluation, TrustFactor, TrustScore } from '../types';
import { extractFeatures } from './features';
import { buildTrust } from './trust';

interface Rule {
  weight: number;
  group: 'deterministic' | 'suggestion' | 'model' | 'meta';
  veto?: boolean;
}

export const RULES: Readonly<Record<string, Rule>> = {
  'suggestion-present:pass': { weight: 0.3, group: 'meta' },
  'suggestion-applies:pass': { weight: 0.3, group: 'suggestion' },
  'suggestion-applies:fail': { weight: -2.5, group: 'suggestion', veto: true },
  'references:pass': { weight: 0.6, group: 'deterministic' },
  'references:fail': { weight: -1.5, group: 'deterministic', veto: true },
  'typecheck:pass': { weight: 0.8, group: 'suggestion' },
  'typecheck:fail': { weight: -3, group: 'suggestion', veto: true },
  'lint:pass': { weight: 0.3, group: 'suggestion' },
  'lint:fail': { weight: -1.5, group: 'suggestion', veto: true },
  'tests:pass': { weight: 0.8, group: 'suggestion' },
  'tests:fail': { weight: -3, group: 'suggestion', veto: true },
  'llm-judge:pass': { weight: 1, group: 'model' },
  'llm-judge:fail': { weight: -1, group: 'model' },
};

export const MODEL_LIMIT = 0.4;
export const VETO_LIMIT = 0.2;
export const GENERATED_FACTOR = 0.5;

export function aggregateByRules(evaluation: Pick<Evaluation, 'recommendation' | 'results'>): TrustScore {
  const features = extractFeatures(evaluation);
  const generated = evaluation.recommendation.suggestionOrigin === 'model';

  const factors: TrustFactor[] = [];
  const modelFactors: TrustFactor[] = [];
  let veto: string | undefined;

  for (const [feature, value] of Object.entries(features)) {
    const rule = RULES[feature];
    if (!rule) continue;
    const factor = rule.group === 'suggestion' && generated ? GENERATED_FACTOR : 1;
    const contribution = rule.weight * value * factor;
    if (rule.group === 'model') modelFactors.push({ feature, contribution });
    else factors.push({ feature, contribution });
    if (rule.veto && !(rule.group === 'suggestion' && generated) && !veto) veto = feature.split(':')[0];
  }

  const modelTotal = modelFactors.reduce((sum, factor) => sum + factor.contribution, 0);
  const scale = Math.abs(modelTotal) > MODEL_LIMIT ? MODEL_LIMIT / Math.abs(modelTotal) : 1;
  for (const factor of modelFactors) factors.push({ feature: factor.feature, contribution: factor.contribution * scale });

  const logit = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  return buildTrust('rules', logit, factors, veto ? { limit: VETO_LIMIT, reason: veto } : undefined);
}
