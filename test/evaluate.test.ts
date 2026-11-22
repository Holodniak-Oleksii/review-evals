import { describe, expect, it } from 'vitest';
import { evaluate, type Grader } from '../src/core';
import { ctx, makeRecommendation } from './helpers';

function grader(name: string, grade: Grader['grade']): Grader {
  return { name, kind: 'static', grade };
}

describe('evaluate', () => {
  it('запускає всі оцінювачі по черзі', async () => {
    const calls: string[] = [];
    const a = grader('a', async () => {
      calls.push('a');
      return { grader: 'a', status: 'pass', score: 1, evidence: 'ok' };
    });
    const b = grader('b', async () => {
      calls.push('b');
      return { grader: 'b', status: 'fail', score: 0, evidence: 'ні' };
    });
    const rec = makeRecommendation();

    const evaluation = await evaluate(rec, [a, b], ctx);

    expect(calls).toEqual(['a', 'b']);
    expect(evaluation.recommendation).toBe(rec);
    expect(evaluation.results.map((r) => r.status)).toEqual(['pass', 'fail']);
  });

  it('перетворює помилку оцінювача на skip і продовжує', async () => {
    const broken = grader('broken', async () => {
      throw new Error('tsc не знайдено');
    });
    const ok = grader('ok', async () => ({ grader: 'ok', status: 'pass', score: 1, evidence: 'ok' }));

    const { results } = await evaluate(makeRecommendation(), [broken, ok], ctx);

    expect(results[0]).toEqual({
      grader: 'broken',
      status: 'skip',
      score: 0,
      evidence: 'Оцінювач завершився з помилкою: tsc не знайдено',
    });
    expect(results[1]?.status).toBe('pass');
  });

  it('відкидає оцінку поза межами 0..1', async () => {
    const bad = grader('bad', async () => ({ grader: 'bad', status: 'pass', score: 1.5, evidence: '' }));

    const { results } = await evaluate(makeRecommendation(), [bad], ctx);

    expect(results[0]?.status).toBe('skip');
    expect(results[0]?.evidence).toContain('некоректна оцінка 1.5');
  });
});
