import type { Mode } from './mode';
import type { Recommendation, TrustScore } from './types';

export type MinimizeSources = 'llm' | 'all';

export interface DecisionOptions {
  minTrust: number;
  minimizeSources: MinimizeSources;
}

export interface Decision {
  reply: boolean;
  minimize: boolean;
}

export function decide(mode: Mode, rec: Recommendation, trust: TrustScore, options: DecisionOptions): Decision {
  const allowed = options.minimizeSources === 'all' || rec.source === 'llm';
  const lowTrust = trust.score < options.minTrust;
  return {
    reply: mode !== 'filter',
    minimize: mode !== 'annotate' && allowed && lowTrust,
  };
}

export function parseMinimizeSources(value: string | undefined): MinimizeSources {
  const normalized = (value ?? '').trim().toLowerCase() || 'llm';
  if (normalized === 'llm' || normalized === 'all') return normalized;
  throw new Error(`Невідоме значення minimize-sources "${value}". Допустимі значення: llm, all.`);
}

export function parseMinTrust(value: string | undefined): number {
  const text = (value ?? '').trim();
  if (text === '') return 0.3;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`Некоректне значення min-trust "${value}". Потрібне число від 0 до 1.`);
  }
  return number;
}
