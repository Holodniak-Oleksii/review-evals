import { formatLocation } from '../report';
import type { GradeResult, Grader } from '../types';

const NAME = 'suggestion-applies';

export const suggestionApplies: Grader = {
  name: NAME,
  kind: 'static',
  async grade(rec, ctx): Promise<GradeResult> {
    if (rec.suggestion === undefined) {
      return { grader: NAME, status: 'skip', score: 0, evidence: 'Немає блоку suggestion.' };
    }
    if (!ctx.workspace) {
      return { grader: NAME, status: 'skip', score: 0, evidence: 'Робочу теку не налаштовано.' };
    }

    const prepared = await ctx.workspace.prepare(rec);
    if (prepared.ok) {
      return {
        grader: NAME,
        status: 'pass',
        score: 1,
        evidence: `Suggestion застосовується до ${formatLocation(rec)}.`,
      };
    }
    return { grader: NAME, status: prepared.status, score: 0, evidence: capitalize(prepared.reason) + '.' };
  },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
