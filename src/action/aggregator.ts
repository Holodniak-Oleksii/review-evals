import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createAggregator, parseWeights, type Aggregator } from '../core';

export type AggregatorChoice = 'auto' | 'rules' | 'logistic';

export interface LoadedAggregator {
  aggregate: Aggregator;
  label: string;
}

export function parseAggregatorChoice(value: string | undefined): AggregatorChoice {
  const normalized = (value ?? '').trim().toLowerCase() || 'auto';
  if (normalized === 'auto' || normalized === 'rules' || normalized === 'logistic') return normalized;
  throw new Error(`Невідомий агрегатор "${value}". Допустимі значення: auto, rules, logistic.`);
}

export function loadAggregator(
  choice: AggregatorChoice,
  weightsFile: string,
  dirs: { workspace: string; actionPath?: string },
): LoadedAggregator {
  const rules = { aggregate: createAggregator('rules'), label: 'правила' };
  if (choice === 'rules') return rules;

  const path = resolveWeightsPath(weightsFile, dirs);
  if (!path || !existsSync(path)) {
    if (choice === 'logistic') throw new Error(`Файл ваг не знайдено: ${path || 'weights.json'}.`);
    return rules;
  }

  const weights = parseWeights(readFileSync(path, 'utf8'));
  return {
    aggregate: createAggregator('logistic', weights),
    label: `логістична регресія (${basename(path)}, прикладів: ${weights.items ?? 'невідомо'})`,
  };
}

function resolveWeightsPath(weightsFile: string, dirs: { workspace: string; actionPath?: string }): string | undefined {
  const file = weightsFile.trim();
  if (file) return isAbsolute(file) ? file : join(dirs.workspace, file);
  return dirs.actionPath ? join(dirs.actionPath, 'weights.json') : undefined;
}
