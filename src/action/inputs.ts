import * as core from '@actions/core';
import {
  DEFAULT_MODEL,
  parseMinimizeSources,
  parseMinTrust,
  parseMode,
  type CommandOverrides,
  type MinimizeSources,
  type Mode,
} from '../core';
import { parseAggregatorChoice, type AggregatorChoice } from './aggregator';

export interface ActionInputs {
  token: string;
  mode: Mode;
  commands: CommandOverrides;
  timeoutMs: number;
  allowForks: boolean;
  anthropicApiKey: string;
  model: string;
  aggregator: AggregatorChoice;
  weightsFile: string;
  minTrust: number;
  minimizeSources: MinimizeSources;
}

const DEFAULT_TIMEOUT_SECONDS = 300;

export function readInputs(): ActionInputs {
  const anthropicApiKey = core.getInput('anthropic-api-key').trim();
  if (anthropicApiKey) core.setSecret(anthropicApiKey);

  return {
    token: core.getInput('github-token', { required: true }),
    mode: parseMode(core.getInput('mode')),
    commands: {
      typecheck: core.getInput('typecheck-command'),
      lint: core.getInput('lint-command'),
      test: core.getInput('test-command'),
    },
    timeoutMs: parseTimeoutSeconds(core.getInput('timeout-seconds')) * 1000,
    allowForks: core.getInput('allow-forks').trim().toLowerCase() === 'true',
    anthropicApiKey,
    model: core.getInput('model').trim() || DEFAULT_MODEL,
    aggregator: parseAggregatorChoice(core.getInput('aggregator')),
    weightsFile: core.getInput('weights-file'),
    minTrust: parseMinTrust(core.getInput('min-trust')),
    minimizeSources: parseMinimizeSources(core.getInput('minimize-sources')),
  };
}

export function parseTimeoutSeconds(value: string): number {
  if (value.trim() === '') return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Некоректне значення timeout-seconds: "${value}". Потрібне додатне число.`);
  }
  return seconds;
}
