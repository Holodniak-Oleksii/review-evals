import { errorMessage } from './errors';
import type { Enricher, EvalContext, Evaluation, GradeResult, Grader, Recommendation } from './types';

export async function evaluate(
  rec: Recommendation,
  graders: readonly Grader[],
  ctx: EvalContext,
  enrichers: readonly Enricher[] = [],
): Promise<Evaluation> {
  const results: GradeResult[] = [];
  let current = rec;

  for (const enricher of enrichers) {
    try {
      const enrichment = await enricher.enrich(current, ctx);
      assertValidScore(enrichment.result.score);
      current = enrichment.recommendation;
      results.push(enrichment.result);
    } catch (error) {
      results.push(failed(enricher.name, error));
    }
  }

  for (const grader of graders) {
    results.push(await runGrader(grader, current, ctx));
  }
  return { recommendation: current, results };
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
    return failed(grader.name, error);
  }
}

function failed(name: string, error: unknown): GradeResult {
  return {
    grader: name,
    status: 'skip',
    score: 0,
    evidence: `Оцінювач завершився з помилкою: ${errorMessage(error)}`,
  };
}

function assertValidScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`некоректна оцінка ${score}, очікується число від 0 до 1`);
  }
}
