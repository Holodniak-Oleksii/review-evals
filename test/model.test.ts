import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  createLlmJudgeGrader,
  createLlmSuggestionEnricher,
  evaluate,
  suggestionPresent,
  type ModelClient,
  type ModelRequest,
  type ModelResult,
  type Workspace,
} from '../src/core';
import { excerpt } from '../src/core/model/context';
import { makeRecommendation } from './helpers';

class FakeModel implements ModelClient {
  readonly model = 'claude-test';
  readonly requests: Array<ModelRequest<z.ZodType>> = [];

  constructor(private readonly answer: ModelResult<unknown>) {}

  async generate<S extends z.ZodType>(request: ModelRequest<S>): Promise<ModelResult<z.infer<S>>> {
    this.requests.push(request);
    return this.answer as ModelResult<z.infer<S>>;
  }
}

const workspace: Workspace = {
  checkout: async () => new URL('./fixtures', import.meta.url).pathname,
  prepare: async () => ({ ok: false, status: 'skip', reason: 'не потрібно' }),
  run: async (_dir, command) => ({ command, exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 }),
};

const rec = makeRecommendation({
  path: 'sample.ts',
  startLine: 2,
  endLine: 2,
  commitId: 'abc',
  body: '[minor] Use `const` here, the value never changes.',
});

describe('llm-judge', () => {
  it('pass з оцінкою = впевненість для правильної рекомендації', async () => {
    const model = new FakeModel({
      ok: true,
      model: 'claude-test',
      value: { verdict: 'correct', confidence: 0.8, reason: 'Змінна не змінюється.' },
    });
    const result = await createLlmJudgeGrader().grade(rec, { repoDir: '/', workspace, model });

    expect(result).toEqual({
      grader: 'llm-judge',
      status: 'pass',
      score: 0.8,
      evidence: 'LLM вважає рекомендацію правильною (claude-test, впевненість 0.80). Змінна не змінюється.',
    });
    expect(model.requests[0]?.prompt).toContain('> 2    let count = 0;');
    expect(model.requests[0]?.prompt).toContain('<comment author="claude[bot]" source="llm">');
    expect(model.requests[0]?.effort).toBe('medium');
  });

  it('fail з оцінкою 1 - впевненість для хибної рекомендації', async () => {
    const model = new FakeModel({
      ok: true,
      model: 'claude-test',
      value: { verdict: 'incorrect', confidence: 0.9, reason: 'Змінна змінюється нижче.' },
    });
    const result = await createLlmJudgeGrader().grade(rec, { repoDir: '/', workspace, model });

    expect(result.status).toBe('fail');
    expect(result.score).toBeCloseTo(0.1);
  });

  it('skip без моделі або при помилці API', async () => {
    expect((await createLlmJudgeGrader().grade(rec, { repoDir: '/', workspace })).status).toBe('skip');
    const failing = new FakeModel({ ok: false, reason: 'перевищено ліміт запитів до Anthropic API' });
    const result = await createLlmJudgeGrader().grade(rec, { repoDir: '/', workspace, model: failing });
    expect(result).toMatchObject({ status: 'skip', evidence: 'LLM не дав відповіді: перевищено ліміт запитів до Anthropic API.' });
  });
});

describe('llm-suggestion', () => {
  it('перетворює текстовий коментар на suggestion з позначкою model', async () => {
    const model = new FakeModel({
      ok: true,
      model: 'claude-test',
      value: { applicable: true, replacement: '```ts\nconst count = 0;\n```', note: 'Замінив let на const.' },
    });
    const evaluation = await evaluate(rec, [suggestionPresent], { repoDir: '/', workspace, model }, [
      createLlmSuggestionEnricher(),
    ]);

    expect(evaluation.recommendation).toMatchObject({ suggestion: 'const count = 0;', suggestionOrigin: 'model' });
    expect(evaluation.results.map((r) => [r.grader, r.status])).toEqual([
      ['llm-suggestion', 'pass'],
      ['suggestion-present', 'skip'],
    ]);
    expect(evaluation.results[1]?.evidence).toContain('Зміну для перевірок згенерував LLM.');
    expect(model.requests[0]?.effort).toBe('high');
  });

  it('не викликає LLM, якщо suggestion уже є', async () => {
    const model = new FakeModel({ ok: false, reason: 'не мав викликатися' });
    const withSuggestion = { ...rec, suggestion: 'const count = 0;', suggestionOrigin: 'comment' as const };
    const { result, recommendation } = await createLlmSuggestionEnricher().enrich(withSuggestion, {
      repoDir: '/',
      workspace,
      model,
    });

    expect(result.status).toBe('skip');
    expect(recommendation).toBe(withSuggestion);
    expect(model.requests).toHaveLength(0);
  });

  it('залишає рекомендацію без змін, якщо LLM каже, що змінювати нічого', async () => {
    const model = new FakeModel({ ok: true, model: 'claude-test', value: { applicable: false, replacement: '', note: 'Це питання.' } });
    const { result, recommendation } = await createLlmSuggestionEnricher().enrich(rec, { repoDir: '/', workspace, model });

    expect(recommendation.suggestion).toBeUndefined();
    expect(result.evidence).toContain('Це питання.');
  });
});

describe('excerpt', () => {
  it('нумерує рядки й позначає прокоментовані', () => {
    expect(excerpt(['a', 'b', 'c'], 2, 2)).toBe('  1  a\n> 2  b\n  3  c');
  });
});
