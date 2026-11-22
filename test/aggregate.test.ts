import { describe, expect, it } from 'vitest';
import {
  aggregateByRules,
  aggregateLogistic,
  extractFeatures,
  parseWeights,
  sigmoid,
  trainLogistic,
  type GradeResult,
  type Recommendation,
} from '../src/core';
import { makeRecommendation } from './helpers';

const pass = (grader: string, score = 1): GradeResult => ({ grader, status: 'pass', score, evidence: '' });
const fail = (grader: string, score = 0): GradeResult => ({ grader, status: 'fail', score, evidence: '' });
const skip = (grader: string): GradeResult => ({ grader, status: 'skip', score: 0, evidence: '' });

const withSuggestion: Recommendation = makeRecommendation({ suggestion: 'x', suggestionOrigin: 'comment', severity: 'bug' });
const textOnly: Recommendation = makeRecommendation({ severity: 'nit' });

describe('extractFeatures', () => {
  it('pass дає оцінку, fail дає силу провалу, skip не дає нічого', () => {
    const features = extractFeatures({
      recommendation: withSuggestion,
      results: [pass('typecheck'), fail('references', 0.25), fail('llm-judge', 0.1), skip('tests'), pass('lint', 0.5)],
    });

    expect(features).toEqual({
      'typecheck:pass': 1,
      'references:fail': 0.75,
      'llm-judge:fail': 0.9,
      'lint:pass': 0.5,
      'source:llm': 1,
      'suggestion:comment': 1,
      'severity:high': 1,
    });
  });
});

describe('aggregateByRules', () => {
  it('усі детерміновані перевірки пройдено — висока довіра', () => {
    const trust = aggregateByRules({
      recommendation: withSuggestion,
      results: [pass('suggestion-present'), pass('suggestion-applies'), pass('typecheck'), pass('lint'), pass('tests')],
    });

    expect(trust.level).toBe('high');
    expect(trust.score).toBeCloseTo(sigmoid(2.5), 3);
    expect(trust.method).toBe('rules');
    expect(trust.factors.map((f) => f.feature)).toEqual(['typecheck:pass', 'tests:pass', 'suggestion-present:pass']);
  });

  it('детермінований fail накладає вето: довіра не вище 0.2', () => {
    const results = [
      pass('suggestion-present'),
      pass('suggestion-applies'),
      pass('references'),
      pass('lint'),
      pass('tests'),
      pass('llm-judge', 0.99),
    ];
    const withoutFail = aggregateByRules({ recommendation: withSuggestion, results });
    const trust = aggregateByRules({ recommendation: withSuggestion, results: [...results, fail('typecheck')] });

    expect(withoutFail.level).toBe('high');
    expect(sigmoid(trust.logit)).toBeGreaterThan(0.2);
    expect(trust).toMatchObject({ score: 0.2, level: 'low', veto: 'typecheck' });
  });

  it('вето не піднімає довіру, якщо вона вже нижча', () => {
    const trust = aggregateByRules({ recommendation: withSuggestion, results: [fail('typecheck'), fail('tests')] });
    expect(trust.score).toBeLessThan(0.01);
  });

  it('LLM сам по собі тримає довіру між 0.40 і 0.60', () => {
    const sure = aggregateByRules({ recommendation: textOnly, results: [pass('llm-judge', 1)] });
    const wrong = aggregateByRules({ recommendation: textOnly, results: [fail('llm-judge', 0)] });

    expect(sure.score).toBeCloseTo(sigmoid(0.4), 3);
    expect(wrong.score).toBeCloseTo(sigmoid(-0.4), 3);
    expect([sure.level, wrong.level]).toEqual(['medium', 'medium']);
  });

  it('для зміни від LLM провали не дають вето і мають половинну вагу', () => {
    const generated = makeRecommendation({ suggestion: 'x', suggestionOrigin: 'model' });
    const trust = aggregateByRules({ recommendation: generated, results: [pass('suggestion-applies'), fail('typecheck')] });

    expect(trust.veto).toBeUndefined();
    expect(trust.logit).toBeCloseTo(0.3 * 0.5 - 3 * 0.5, 3);
  });

  it('без жодних сигналів довіра 0.5', () => {
    expect(aggregateByRules({ recommendation: textOnly, results: [skip('typecheck')] }).score).toBe(0.5);
  });
});

describe('логістична регресія', () => {
  it('рахує довіру за вагами з weights.json', () => {
    const weights = parseWeights(JSON.stringify({ version: 1, bias: -0.5, weights: { 'typecheck:pass': 2, 'llm-judge:pass': 0.5 } }));
    const trust = aggregateLogistic({ recommendation: withSuggestion, results: [pass('typecheck'), pass('llm-judge', 0.8)] }, weights);

    expect(trust.method).toBe('logistic');
    expect(trust.logit).toBeCloseTo(-0.5 + 2 + 0.4, 3);
    expect(trust.score).toBeCloseTo(sigmoid(1.9), 3);
  });

  it('відхиляє некоректний weights.json', () => {
    expect(() => parseWeights('{"version":2,"bias":0,"weights":{}}')).toThrow('Непідтримуваний формат');
    expect(() => parseWeights('{"version":1,"bias":0,"weights":{"a":"x"}}')).toThrow('Некоректна вага');
  });

  it('навчається на роздільних даних', () => {
    const examples = [
      ...Array.from({ length: 10 }, () => ({ features: { 'typecheck:fail': 1 }, label: 0 as const })),
      ...Array.from({ length: 10 }, () => ({ features: { 'tests:pass': 1, 'typecheck:pass': 1 }, label: 1 as const })),
    ];
    const { weights, accuracy, logLoss } = trainLogistic(examples, { l2: 0.1 });

    expect(accuracy).toBe(1);
    expect(logLoss).toBeLessThan(0.2);
    expect(weights.weights['typecheck:fail']).toBeLessThan(0);
    expect(weights.weights['tests:pass']).toBeGreaterThan(0);
    expect(weights.items).toBe(20);
  });
});
