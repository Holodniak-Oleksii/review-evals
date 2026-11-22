import { describe, expect, it } from 'vitest';
import { MARKER, formatLocation, renderReply, renderSummary, type Evaluation } from '../src/core';
import { makeRecommendation } from './helpers';

const evaluation: Evaluation = {
  recommendation: makeRecommendation({
    startLine: 10,
    endLine: 12,
    url: 'https://github.com/owner/demo/pull/1#discussion_r101',
  }),
  results: [
    { grader: 'suggestion-present', status: 'pass', score: 1, evidence: 'Є блок suggestion.' },
    { grader: 'tsc', status: 'fail', score: 0, evidence: 'Помилка компіляції.' },
    { grader: 'tests', status: 'skip', score: 0, evidence: 'Тестів немає.' },
  ],
};

describe('formatLocation', () => {
  it('один рядок, діапазон і файл без рядків', () => {
    expect(formatLocation(makeRecommendation({ startLine: 7, endLine: 7 }))).toBe('src/App.tsx:7');
    expect(formatLocation(makeRecommendation({ startLine: 7, endLine: 9 }))).toBe('src/App.tsx:7-9');
    expect(formatLocation(makeRecommendation({ startLine: null, endLine: null }))).toBe('src/App.tsx');
  });
});

describe('renderReply', () => {
  it('починається з маркера й містить джерело та чек-лист', () => {
    const reply = renderReply(evaluation);

    expect(reply.startsWith(MARKER)).toBe(true);
    expect(reply).toContain('Джерело: **LLM (`claude[bot]`)**');
    expect(reply).toContain('- ✔ `suggestion-present` — Є блок suggestion.');
    expect(reply).toContain('- ✘ `tsc` — Помилка компіляції.');
    expect(reply).toContain('- – `tests` — Тестів немає.');
  });

  it('позначає людину як джерело', () => {
    const reply = renderReply({
      recommendation: makeRecommendation({ source: 'human', author: 'alice' }),
      results: [],
    });

    expect(reply).toContain('Джерело: **людина (`alice`)**');
  });
});

describe('renderSummary', () => {
  it('будує таблицю «файл:рядки | джерело | результати»', () => {
    const md = renderSummary({
      pullNumber: 1,
      mode: 'annotate',
      evaluations: [evaluation],
      alreadyEvaluated: 2,
      failed: 0,
    });

    expect(md).toContain('## Review Evals — PR #1');
    expect(md).toContain('Вже оцінено раніше: 2.');
    expect(md).toContain('| Файл:рядки | Джерело | Результати оцінювачів |');
    expect(md).toContain(
      '| [`src/App.tsx:10-12`](https://github.com/owner/demo/pull/1#discussion_r101) ' +
        '| LLM (`claude[bot]`) | ✔ suggestion-present<br>✘ tsc<br>– tests |',
    );
  });

  it('екранує | у клітинках', () => {
    const md = renderSummary({
      pullNumber: 1,
      mode: 'annotate',
      evaluations: [{ recommendation: makeRecommendation({ path: 'a|b.ts' }), results: [] }],
      alreadyEvaluated: 0,
      failed: 0,
    });

    expect(md).toContain('`a\\|b.ts:10`');
  });

  it('показує команди перевірок', () => {
    const md = renderSummary({
      pullNumber: 1,
      mode: 'annotate',
      evaluations: [],
      alreadyEvaluated: 0,
      failed: 0,
      commands: { typecheck: 'pnpm run typecheck', lint: 'pnpm exec eslint', test: null },
    });

    expect(md).toContain(
      'Команди: typecheck — `pnpm run typecheck`; lint — `pnpm exec eslint`; tests — вимкнено.',
    );
  });

  it('повідомляє, що нових коментарів немає', () => {
    const md = renderSummary({ pullNumber: 3, mode: 'annotate', evaluations: [], alreadyEvaluated: 4, failed: 1 });

    expect(md).toContain('Помилок: 1.');
    expect(md).toContain('_Нових коментарів для оцінювання немає._');
    expect(md).not.toContain('| Файл:рядки');
  });
});
