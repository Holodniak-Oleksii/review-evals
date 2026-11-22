import * as core from '@actions/core';
import { parseMode, type CommandOverrides, type Mode } from '../core';

export interface ActionInputs {
  token: string;
  mode: Mode;
  commands: CommandOverrides;
  timeoutMs: number;
  allowForks: boolean;
}

const DEFAULT_TIMEOUT_SECONDS = 300;

export function readInputs(): ActionInputs {
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
