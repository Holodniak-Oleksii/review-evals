import { extractFeatures, trainLogistic, type Dataset, type TrainingExample, type TrainingResult } from '../core';

export const MIN_EXAMPLES = 10;

export interface PreparedExamples {
  examples: TrainingExample[];
  skipped: { unlabeled: number; unclear: number; withoutResults: number };
}

export function prepareExamples(dataset: Dataset): PreparedExamples {
  const skipped = { unlabeled: 0, unclear: 0, withoutResults: 0 };
  const examples: TrainingExample[] = [];
  for (const item of dataset.items) {
    if (item.label === null) skipped.unlabeled++;
    else if (item.label === 'unclear') skipped.unclear++;
    else if (item.results === null) skipped.withoutResults++;
    else {
      examples.push({
        features: extractFeatures({ recommendation: item.recommendation, results: item.results }),
        label: item.label === 'correct' ? 1 : 0,
      });
    }
  }
  return { examples, skipped };
}

export function train(dataset: Dataset, datasetName: string, l2: number): TrainingResult {
  const { examples } = prepareExamples(dataset);
  if (examples.length < MIN_EXAMPLES) {
    throw new Error(
      `Замало розмічених прикладів з результатами: ${examples.length}. Потрібно щонайменше ${MIN_EXAMPLES} (мітки correct або incorrect).`,
    );
  }
  const labels = new Set(examples.map((example) => example.label));
  if (labels.size < 2) throw new Error('Потрібні приклади обох класів: correct і incorrect.');

  const result = trainLogistic(examples, { l2 });
  result.weights.dataset = datasetName;
  result.weights.trainedAt = new Date().toISOString();
  return result;
}
