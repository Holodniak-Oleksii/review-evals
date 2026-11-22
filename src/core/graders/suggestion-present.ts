import type { GradeResult, Grader } from '../types';

const NAME = 'suggestion-present';

export const suggestionPresent: Grader = {
  name: NAME,
  kind: 'static',
  async grade(rec): Promise<GradeResult> {
    if (rec.suggestion === undefined || rec.suggestionOrigin === 'model') {
      const generated = rec.suggestionOrigin === 'model' ? ' Зміну для перевірок згенерував LLM.' : '';
      return {
        grader: NAME,
        status: 'skip',
        score: 0,
        evidence: `Коментар не містить блоку suggestion: це лише текстова рекомендація.${generated}`,
      };
    }

    const evidence =
      rec.suggestion === ''
        ? 'Коментар містить порожній блок suggestion: пропонує видалити рядки.'
        : `Коментар містить блок suggestion (рядків коду: ${rec.suggestion.split('\n').length}).`;

    return { grader: NAME, status: 'pass', score: 1, evidence };
  },
};
