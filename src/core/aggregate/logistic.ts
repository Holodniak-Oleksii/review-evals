import type { Evaluation, TrustScore } from '../types';
import { extractFeatures, type Features } from './features';
import { buildTrust, sigmoid } from './trust';

export const WEIGHTS_VERSION = 1;

export interface Weights {
  version: number;
  bias: number;
  weights: Record<string, number>;
  trainedAt?: string;
  dataset?: string;
  items?: number;
  l2?: number;
}

export function aggregateLogistic(
  evaluation: Pick<Evaluation, 'recommendation' | 'results'>,
  model: Weights,
): TrustScore {
  const features = extractFeatures(evaluation);
  const factors = Object.entries(features)
    .filter(([feature]) => model.weights[feature] !== undefined)
    .map(([feature, value]) => ({ feature, contribution: (model.weights[feature] ?? 0) * value }));
  const logit = model.bias + factors.reduce((sum, factor) => sum + factor.contribution, 0);
  return buildTrust('logistic', logit, factors);
}

export function parseWeights(json: string): Weights {
  const data = JSON.parse(json) as Weights;
  if (data.version !== WEIGHTS_VERSION || typeof data.bias !== 'number' || typeof data.weights !== 'object') {
    throw new Error(`Непідтримуваний формат weights.json (очікується version ${WEIGHTS_VERSION}).`);
  }
  for (const [feature, weight] of Object.entries(data.weights)) {
    if (!Number.isFinite(weight)) throw new Error(`Некоректна вага для "${feature}" у weights.json.`);
  }
  return data;
}

export interface TrainingExample {
  features: Features;
  label: 0 | 1;
}

export interface TrainingOptions {
  l2?: number;
  epochs?: number;
  learningRate?: number;
}

export interface TrainingResult {
  weights: Weights;
  logLoss: number;
  accuracy: number;
}

export function trainLogistic(examples: readonly TrainingExample[], options: TrainingOptions = {}): TrainingResult {
  if (examples.length === 0) throw new Error('Немає прикладів для навчання.');
  const l2 = options.l2 ?? 1;
  const epochs = options.epochs ?? 3000;
  const learningRate = options.learningRate ?? 0.5;

  const names = [...new Set(examples.flatMap((example) => Object.keys(example.features)))].sort();
  const rows = examples.map((example) => names.map((name) => example.features[name] ?? 0));
  const labels = examples.map((example) => example.label);
  const n = examples.length;
  const w = names.map(() => 0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = names.map((_, j) => (l2 * (w[j] ?? 0)) / n);
    let gradB = 0;
    rows.forEach((row, i) => {
      const error = sigmoid(bias + dot(w, row)) - (labels[i] ?? 0);
      gradB += error / n;
      row.forEach((x, j) => (gradW[j] = (gradW[j] ?? 0) + (error * x) / n));
    });
    bias -= learningRate * gradB;
    w.forEach((_, j) => (w[j] = (w[j] ?? 0) - learningRate * (gradW[j] ?? 0)));
  }

  let loss = 0;
  let correct = 0;
  rows.forEach((row, i) => {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoid(bias + dot(w, row))));
    const y = labels[i] ?? 0;
    loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
  });

  const weights: Record<string, number> = {};
  names.forEach((name, j) => {
    const value = w[j] ?? 0;
    if (Math.abs(value) >= 1e-4) weights[name] = Math.round(value * 10_000) / 10_000;
  });

  return {
    weights: { version: WEIGHTS_VERSION, bias: Math.round(bias * 10_000) / 10_000, weights, items: n, l2 },
    logLoss: loss / n,
    accuracy: correct / n,
  };
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
