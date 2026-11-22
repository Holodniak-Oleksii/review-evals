import { describe, expect, it } from 'vitest';
import { parseTimeoutSeconds } from '../src/action/inputs';
import { isForkPullRequest, resolvePullRequestNumber } from '../src/action/pull-request';
import { parseMode } from '../src/core';

describe('resolvePullRequestNumber', () => {
  it('бере номер з payload.pull_request', () => {
    expect(resolvePullRequestNumber({ pull_request: { number: 7 } })).toBe(7);
  });

  it('бере номер з payload.workflow_run.pull_requests[0]', () => {
    expect(
      resolvePullRequestNumber({ workflow_run: { pull_requests: [{ number: 12 }, { number: 13 }] } }),
    ).toBe(12);
  });

  it('повертає undefined, якщо PR немає', () => {
    expect(resolvePullRequestNumber({})).toBeUndefined();
    expect(resolvePullRequestNumber({ workflow_run: { pull_requests: [] } })).toBeUndefined();
  });
});

describe('parseMode', () => {
  it('порожнє значення — annotate', () => {
    expect(parseMode('')).toBe('annotate');
    expect(parseMode(undefined)).toBe('annotate');
  });

  it('приймає відомі режими', () => {
    expect(parseMode('filter')).toBe('filter');
    expect(parseMode(' Hybrid ')).toBe('hybrid');
  });

  it('відхиляє невідомий режим', () => {
    expect(() => parseMode('delete')).toThrow('Невідомий режим "delete"');
  });
});

describe('isForkPullRequest', () => {
  it('порівнює репозиторій PR з базовим', () => {
    const repository = { full_name: 'owner/demo' };
    expect(isForkPullRequest({ repository, pull_request: { number: 1, head: { repo: { full_name: 'owner/demo' } } } })).toBe(false);
    expect(isForkPullRequest({ repository, pull_request: { number: 1, head: { repo: { full_name: 'other/demo' } } } })).toBe(true);
    expect(isForkPullRequest({ repository, workflow_run: { head_repository: { full_name: 'other/demo' } } })).toBe(true);
    expect(isForkPullRequest({})).toBe(false);
  });
});

describe('parseTimeoutSeconds', () => {
  it('порожнє значення — 300, некоректне — помилка', () => {
    expect(parseTimeoutSeconds('')).toBe(300);
    expect(parseTimeoutSeconds('45')).toBe(45);
    expect(() => parseTimeoutSeconds('-1')).toThrow('timeout-seconds');
  });
});
