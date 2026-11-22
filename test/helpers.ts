import type { Recommendation, ReviewComment } from '../src/core';

export function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 101,
    body: 'Коментар без коду.',
    path: 'src/App.tsx',
    line: 10,
    start_line: null,
    original_line: 10,
    original_start_line: null,
    commit_id: 'head-sha',
    original_commit_id: 'head-sha',
    html_url: 'https://github.com/owner/demo/pull/1#discussion_r101',
    in_reply_to_id: undefined,
    user: { login: 'claude[bot]', type: 'Bot' },
    ...overrides,
  };
}

export function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: '101',
    source: 'llm',
    author: 'claude[bot]',
    path: 'src/App.tsx',
    startLine: 10,
    endLine: 10,
    body: 'Коментар без коду.',
    ...overrides,
  };
}

export const ctx = { repoDir: '/tmp/repo' };
