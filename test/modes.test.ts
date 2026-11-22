import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAggregator, parseAggregatorChoice } from '../src/action/aggregator';
import { prepareExamples, train } from '../src/cli/train';
import {
  aggregateByRules,
  decide,
  hasMarker,
  isStateComment,
  parseMinimizeSources,
  parseMinTrust,
  parseState,
  recordEvaluation,
  renderReply,
  renderState,
  renderSummary,
  selectPendingComments,
  emptyState,
  type Dataset,
  type DatasetItem,
  type Evaluation,
  type TrustScore,
} from '../src/core';
import { makeComment, makeRecommendation } from './helpers';

const low: TrustScore = { score: 0.2, level: 'low', method: 'rules', logit: -3, factors: [], veto: 'typecheck' };
const high: TrustScore = { score: 0.9, level: 'high', method: 'rules', logit: 2.2, factors: [] };
const options = { minTrust: 0.3, minimizeSources: 'llm' as const };
const llm = makeRecommendation();
const human = makeRecommendation({ source: 'human', author: 'alice' });

describe('decide', () => {
  it('annotate лише відповідає', () => {
    expect(decide('annotate', llm, low, options)).toEqual({ reply: true, minimize: false });
  });

  it('filter лише згортає коментар LLM з низькою довірою', () => {
    expect(decide('filter', llm, low, options)).toEqual({ reply: false, minimize: true });
    expect(decide('filter', llm, high, options)).toEqual({ reply: false, minimize: false });
    expect(decide('filter', human, low, options)).toEqual({ reply: false, minimize: false });
    expect(decide('filter', human, low, { ...options, minimizeSources: 'all' })).toEqual({ reply: false, minimize: true });
  });

  it('hybrid відповідає і згортає', () => {
    expect(decide('hybrid', llm, low, options)).toEqual({ reply: true, minimize: true });
  });

  it('перевіряє значення inputs', () => {
    expect(parseMinTrust('')).toBe(0.3);
    expect(parseMinTrust('0.5')).toBe(0.5);
    expect(() => parseMinTrust('2')).toThrow('min-trust');
    expect(parseMinimizeSources('ALL')).toBe('all');
    expect(() => parseMinimizeSources('bots')).toThrow('minimize-sources');
    expect(parseAggregatorChoice('')).toBe('auto');
    expect(() => parseAggregatorChoice('neural')).toThrow('Невідомий агрегатор');
  });
});

describe('стан PR для режиму filter', () => {
  const evaluation: Evaluation = {
    recommendation: makeRecommendation({ url: 'https://github.com/o/r/pull/1#discussion_r7' }),
    results: [],
    trust: low,
  };

  it('зберігає й читає оцінені коментарі', () => {
    const state = emptyState();
    recordEvaluation(state, '7', evaluation, true);
    recordEvaluation(state, '8', { ...evaluation, trust: high }, false);
    const body = renderState(state, 0.3);

    expect(isStateComment(body)).toBe(true);
    expect(hasMarker(body)).toBe(false);
    expect(body).toContain('згорнуто 1 з 2 рекомендацій з довірою нижче 0.30');
    expect(body).toContain('| [`src/App.tsx:10`](https://github.com/o/r/pull/1#discussion_r7) | 0.20 |');
    expect(parseState(body).evaluated).toEqual(state.evaluated);
    expect(parseState('інший коментар')).toEqual(emptyState());
  });

  it('коментарі зі стану вважаються вже оціненими', () => {
    const comments = [makeComment({ id: 7 }), makeComment({ id: 9 })];
    const { pending, alreadyEvaluated } = selectPendingComments(comments, ['7']);

    expect(pending.map((c) => c.id)).toEqual([9]);
    expect(alreadyEvaluated.map((c) => c.id)).toEqual([7]);
  });
});

describe('довіра у відповіді та Job Summary', () => {
  it('показує оцінку, вето, чинники і згортання', () => {
    const trust = aggregateByRules({
      recommendation: llm,
      results: [
        { grader: 'typecheck', status: 'fail', score: 0, evidence: '' },
        { grader: 'tests', status: 'pass', score: 1, evidence: '' },
      ],
    });
    const reply = renderReply({ recommendation: llm, results: [], trust }, { minimized: true, minTrust: 0.3 });

    expect(reply).toContain('Оцінка довіри: **0.10** — низька (правила)\n');
    expect(reply).not.toContain('обмежено через');
    expect(reply).toContain('Головні чинники: ✘ typecheck −3.00 · ✔ tests +0.80');
    expect(reply).toContain('Коментар згорнуто: довіра нижче порогу 0.30.');
  });

  it('Job Summary має колонку довіри', () => {
    const md = renderSummary({
      pullNumber: 1,
      mode: 'hybrid',
      evaluations: [{ recommendation: llm, results: [], trust: low, minimized: true }],
      alreadyEvaluated: 0,
      failed: 0,
      aggregation: 'правила',
    });

    expect(md).toContain('Згорнуто: 1.');
    expect(md).toContain('Агрегація: правила.');
    expect(md).toContain('| Файл:рядки | Джерело | Довіра | Результати оцінювачів |');
    expect(md).toContain('| `src/App.tsx:10` | LLM (`claude[bot]`) | 0.20 низька<br>згорнуто | — |');
  });
});

describe('завантаження агрегатора', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('auto бере weights.json Action, якщо він є, інакше правила', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-evals-weights-'));
    dirs.push(dir);
    expect(loadAggregator('auto', '', { workspace: dir, actionPath: dir }).label).toBe('правила');

    writeFileSync(join(dir, 'weights.json'), JSON.stringify({ version: 1, bias: 0, weights: {}, items: 42 }));
    expect(loadAggregator('auto', '', { workspace: dir, actionPath: dir }).label).toBe(
      'логістична регресія (weights.json, прикладів: 42)',
    );
    expect(loadAggregator('rules', '', { workspace: dir, actionPath: dir }).label).toBe('правила');
  });

  it('logistic без файлу ваг — помилка', () => {
    expect(() => loadAggregator('logistic', 'missing.json', { workspace: tmpdir() })).toThrow('Файл ваг не знайдено');
  });
});

describe('навчання з датасету', () => {
  const item = (id: number, label: DatasetItem['label'], typecheck: 'pass' | 'fail' | null): DatasetItem => ({
    id: `o/r#1/${id}`,
    repo: 'o/r',
    pullNumber: 1,
    recommendation: makeRecommendation({ id: String(id) }),
    results: typecheck ? [{ grader: 'typecheck', status: typecheck, score: typecheck === 'pass' ? 1 : 0, evidence: '' }] : null,
    label,
    note: '',
  });

  it('бере лише correct/incorrect з результатами', () => {
    const dataset: Dataset = {
      version: 1,
      items: [item(1, 'correct', 'pass'), item(2, null, 'pass'), item(3, 'unclear', 'pass'), item(4, 'incorrect', null)],
    };
    const { examples, skipped } = prepareExamples(dataset);

    expect(examples).toHaveLength(1);
    expect(skipped).toEqual({ unlabeled: 1, unclear: 1, withoutResults: 1 });
  });

  it('вимагає щонайменше 10 прикладів обох класів', () => {
    const few: Dataset = { version: 1, items: [item(1, 'correct', 'pass')] };
    expect(() => train(few, 'd.json', 1)).toThrow('Замало розмічених прикладів');

    const oneClass: Dataset = { version: 1, items: Array.from({ length: 10 }, (_, i) => item(i, 'correct', 'pass')) };
    expect(() => train(oneClass, 'd.json', 1)).toThrow('обох класів');

    const balanced: Dataset = {
      version: 1,
      items: Array.from({ length: 12 }, (_, i) => item(i, i % 2 ? 'correct' : 'incorrect', i % 2 ? 'pass' : 'fail')),
    };
    const result = train(balanced, 'd.json', 1);
    expect(result.weights).toMatchObject({ version: 1, dataset: 'd.json', items: 12 });
    expect(result.accuracy).toBe(1);
  });
});
