import { describe, expect, it } from 'vitest';
import { extractSuggestion, parseRecommendation } from '../src/core';
import { makeComment } from './helpers';

describe('parseRecommendation', () => {
  it('витягує код із блоку suggestion', () => {
    const rec = parseRecommendation(
      makeComment({ body: 'Краще без `let`:\n```suggestion\nconst count = 0;\n```' }),
    );

    expect(rec).toEqual({
      id: '101',
      source: 'llm',
      author: 'claude[bot]',
      path: 'src/App.tsx',
      startLine: 10,
      endLine: 10,
      body: 'Краще без `let`:\n```suggestion\nconst count = 0;\n```',
      suggestion: 'const count = 0;',
      commitId: 'head-sha',
      url: 'https://github.com/owner/demo/pull/1#discussion_r101',
    });
  });

  it('не має поля suggestion, якщо блоку немає', () => {
    const rec = parseRecommendation(makeComment({ body: 'Варто додати тест на цей випадок.' }));

    expect(rec.suggestion).toBeUndefined();
    expect('suggestion' in rec).toBe(false);
  });

  it('не плутає suggestion з іншими блоками коду', () => {
    const rec = parseRecommendation(makeComment({ body: 'Наприклад:\n```ts\nconst x = 1;\n```' }));

    expect(rec.suggestion).toBeUndefined();
  });

  it('обробляє кінці рядків \\r\\n', () => {
    const rec = parseRecommendation(
      makeComment({ body: 'Fix:\r\n```suggestion\r\nconst a = 1;\r\nconst b = 2;\r\n```\r\n' }),
    );

    expect(rec.suggestion).toBe('const a = 1;\nconst b = 2;');
    expect(rec.suggestion).not.toContain('\r');
  });

  it('обробляє багаторядковий suggestion і діапазон рядків', () => {
    const body = [
      'Винеси обробник:',
      '```suggestion',
      'function handleClick() {',
      '  setCount((c) => c + 1);',
      '',
      '}',
      '```',
      'Так легше тестувати.',
    ].join('\n');

    const rec = parseRecommendation(makeComment({ body, start_line: 5, line: 8 }));

    expect(rec.suggestion).toBe('function handleClick() {\n  setCount((c) => c + 1);\n\n}');
    expect(rec.startLine).toBe(5);
    expect(rec.endLine).toBe(8);
  });

  it('визначає людину за user.type', () => {
    const rec = parseRecommendation(makeComment({ user: { login: 'alice', type: 'User' } }));

    expect(rec.source).toBe('human');
    expect(rec.author).toBe('alice');
  });

  it('вважає видаленого користувача людиною', () => {
    const rec = parseRecommendation(makeComment({ user: null }));

    expect(rec.source).toBe('human');
    expect(rec.author).toBe('ghost');
  });

  it('для застарілого коментаря бере original_* рядки й коміт', () => {
    const rec = parseRecommendation(
      makeComment({
        line: null,
        start_line: null,
        original_line: 20,
        original_start_line: 18,
        original_commit_id: 'old-sha',
      }),
    );

    expect(rec.startLine).toBe(18);
    expect(rec.endLine).toBe(20);
    expect(rec.commitId).toBe('old-sha');
  });

  it('для коментаря до файлу повертає null-рядки', () => {
    const rec = parseRecommendation(
      makeComment({ line: null, start_line: null, original_line: null, original_start_line: null }),
    );

    expect(rec.startLine).toBeNull();
    expect(rec.endLine).toBeNull();
  });
});

describe('extractSuggestion', () => {
  it('порожній блок означає видалення рядків', () => {
    expect(extractSuggestion('Видали:\n```suggestion\n```')).toBe('');
  });

  it('підтримує довшу огорожу з ``` всередині', () => {
    const body = '````suggestion\n```ts\nconst x = 1;\n```\n````';

    expect(extractSuggestion(body)).toBe('```ts\nconst x = 1;\n```');
  });

  it('прибирає відступ огорожі з рядків коду', () => {
    expect(extractSuggestion('  ```suggestion\n    return x;\n  ```')).toBe('  return x;');
  });

  it('бере перший блок, якщо їх кілька', () => {
    expect(extractSuggestion('```suggestion\na\n```\n```suggestion\nb\n```')).toBe('a');
  });

  it('незакритий блок триває до кінця тексту', () => {
    expect(extractSuggestion('```suggestion\nconst x = 1;\n')).toBe('const x = 1;');
  });
});
