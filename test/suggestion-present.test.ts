import { describe, expect, it } from 'vitest';
import { suggestionPresent } from '../src/core';
import { ctx, makeRecommendation } from './helpers';

describe('suggestion-present', () => {
  it('є статичним оцінювачем', () => {
    expect(suggestionPresent.name).toBe('suggestion-present');
    expect(suggestionPresent.kind).toBe('static');
  });

  it('pass і score 1, якщо є suggestion', async () => {
    const result = await suggestionPresent.grade(
      makeRecommendation({ suggestion: 'const a = 1;\nconst b = 2;' }),
      ctx,
    );

    expect(result).toEqual({
      grader: 'suggestion-present',
      status: 'pass',
      score: 1,
      evidence: 'Коментар містить блок suggestion (рядків коду: 2).',
    });
  });

  it('pass для порожнього suggestion (видалення рядків)', async () => {
    const result = await suggestionPresent.grade(makeRecommendation({ suggestion: '' }), ctx);

    expect(result.status).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.evidence).toContain('видалити');
  });

  it('skip і score 0, якщо suggestion немає', async () => {
    const result = await suggestionPresent.grade(makeRecommendation(), ctx);

    expect(result.status).toBe('skip');
    expect(result.score).toBe(0);
    expect(result.evidence).toContain('не містить');
  });
});
