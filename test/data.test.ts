import { describe, expect, it } from 'vitest';
import { collectItems } from '../src/cli/export';
import {
  extractSeverity,
  MARKER,
  mergeDataset,
  parseReplyData,
  renderReply,
  type DatasetItem,
  type Evaluation,
} from '../src/core';
import { makeComment, makeRecommendation } from './helpers';

const evaluation: Evaluation = {
  recommendation: makeRecommendation({
    severity: 'bug',
    suggestion: 'const a = "<b>-->";',
    suggestionOrigin: 'model',
    commitId: 'abc',
  }),
  results: [{ grader: 'typecheck', status: 'pass', score: 1, evidence: 'Зміна не додає помилок TypeScript.' }],
};

describe('дані у відповіді', () => {
  it('відповідь містить тег, згенеровану зміну і JSON без -->', () => {
    const reply = renderReply(evaluation);

    expect(reply).toContain('Джерело: **LLM (`claude[bot]`)** · тег `bug`');
    expect(reply).toContain('<summary>Зміна, яку згенерував LLM для src/App.tsx:10</summary>');
    expect(reply).toContain('```\nconst a = "<b>-->";\n```');
    const dataLine = reply.split('\n').at(-1)!;
    expect(dataLine.startsWith('<!-- review-evals-data ')).toBe(true);
    expect(dataLine.slice(0, -4)).not.toContain('-->');
  });

  it('дані читаються назад без тексту коментаря', () => {
    const data = parseReplyData(renderReply(evaluation));

    expect(data?.results).toEqual(evaluation.results);
    expect(data?.recommendation).toMatchObject({ suggestion: 'const a = "<b>-->";', suggestionOrigin: 'model' });
    expect(data?.recommendation).not.toHaveProperty('body');
    expect(parseReplyData('звичайний коментар')).toBeUndefined();
  });
});

describe('extractSeverity', () => {
  it('бере тег на початку коментаря', () => {
    expect(extractSeverity('[Bug] Off by one.')).toBe('bug');
    expect(extractSeverity('**[nit]** Typo.')).toBe('nit');
    expect(extractSeverity('No tag [minor] here.')).toBeUndefined();
  });
});

describe('експорт датасету', () => {
  it('збирає рекомендації з результатами з відповідей Review Evals', () => {
    const root = makeComment({ id: 1, body: '[minor] Rename `x`.' });
    const reply = makeComment({ id: 2, in_reply_to_id: 1, body: renderReply(evaluation) });
    const other = makeComment({ id: 3, body: 'Text only.' });

    const items = collectItems('o/r', 5, [root, reply, other]);

    expect(items.map((item) => [item.id, item.results?.length ?? null])).toEqual([
      ['o/r#5/1', 1],
      ['o/r#5/3', null],
    ]);
    expect(items[0]?.recommendation).toMatchObject({ body: '[minor] Rename `x`.', suggestionOrigin: 'model' });
    expect(items[0]).toMatchObject({ label: null, note: '' });
  });

  it('повторний експорт не стирає мітки', () => {
    const item: DatasetItem = {
      id: 'o/r#5/1',
      repo: 'o/r',
      pullNumber: 5,
      recommendation: makeRecommendation(),
      results: null,
      label: null,
      note: '',
    };
    const labeled = { ...item, label: 'incorrect' as const, note: 'хибна' };
    const fresh = { ...item, results: evaluation.results };

    const { dataset, added, updated } = mergeDataset({ version: 1, items: [labeled] }, [fresh, { ...item, id: 'o/r#5/2' }]);

    expect([added, updated]).toEqual([1, 1]);
    expect(dataset.items[0]).toMatchObject({ label: 'incorrect', note: 'хибна', results: evaluation.results });
  });

  it('пропускає власні відповіді, навіть кореневі', () => {
    expect(collectItems('o/r', 1, [makeComment({ id: 9, body: `${MARKER}\nx` })])).toEqual([]);
  });
});
