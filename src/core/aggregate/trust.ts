import type { AggregationMethod, TrustFactor, TrustLevel, TrustScore } from '../types';

export const HIGH_TRUST = 0.7;
export const MEDIUM_TRUST = 0.4;
const MAX_FACTORS = 3;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function trustLevel(score: number): TrustLevel {
  if (score >= HIGH_TRUST) return 'high';
  if (score >= MEDIUM_TRUST) return 'medium';
  return 'low';
}

export function buildTrust(
  method: AggregationMethod,
  logit: number,
  contributions: TrustFactor[],
  cap?: { limit: number; reason: string },
): TrustScore {
  const raw = sigmoid(logit);
  const capped = cap && raw > cap.limit;
  const score = round(capped ? cap.limit : raw);
  const factors = contributions
    .filter((factor) => Math.abs(factor.contribution) >= 0.005)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, MAX_FACTORS)
    .map((factor) => ({ feature: factor.feature, contribution: round(factor.contribution) }));

  return {
    score,
    level: trustLevel(score),
    method,
    logit: round(logit),
    factors,
    ...(capped ? { veto: cap.reason } : {}),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
