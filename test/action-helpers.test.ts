import { describe, expect, it } from 'vitest';
import { resolvePullRequestNumber } from '../src/action/pull-request';
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
