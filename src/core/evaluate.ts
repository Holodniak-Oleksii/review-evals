import { errorMessage } from './errors';
import type { EvalContext, Evaluation, GradeResult, Grader, Recommendation } from './types';

export async function evaluate(
  rec: Recommendation,
  graders: readonly Grader[],
  ctx: EvalContext,
): Promise<Evaluation> {
  const results: GradeResult[] = [];
  for (const grader of graders) {
    results.push(await runGrader(grader, rec, ctx));
  }
  return { recommendation: rec, results };
}

export async function runGrader(
  grader: Grader,
  rec: Recommendation,
  ctx: EvalContext,
): Promise<GradeResult> {
  try {
    const result = await grader.grade(rec, ctx);
    assertValidScore(result.score);
    return result;
  } catch (error) {
    return {
      grader: grader.name,
      status: 'skip',
      score: 0,
      evidence: `Оцінювач завершився з помилкою: ${errorMessage(error)}`,
    };
  }
}

function assertValidScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`некоректна оцінка ${score}, очікується число від 0 до 1`);
  }
}
