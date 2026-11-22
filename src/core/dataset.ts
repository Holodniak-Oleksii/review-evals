import type { GradeResult, Recommendation } from './types';

export const DATASET_VERSION = 1;

export type Label = 'correct' | 'incorrect' | 'unclear';

export interface DatasetItem {
  id: string;
  repo: string;
  pullNumber: number;
  recommendation: Recommendation;
  results: GradeResult[] | null;
  label: Label | null;
  note: string;
}

export interface Dataset {
  version: number;
  items: DatasetItem[];
}

export function emptyDataset(): Dataset {
  return { version: DATASET_VERSION, items: [] };
}

export function itemId(repo: string, pullNumber: number, commentId: string): string {
  return `${repo}#${pullNumber}/${commentId}`;
}

export function mergeDataset(existing: Dataset, incoming: DatasetItem[]): { dataset: Dataset; added: number; updated: number } {
  const byId = new Map(existing.items.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    const previous = byId.get(item.id);
    if (previous) {
      byId.set(item.id, { ...item, results: item.results ?? previous.results, label: previous.label, note: previous.note });
      updated++;
    } else {
      byId.set(item.id, item);
      added++;
    }
  }

  const items = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { dataset: { version: DATASET_VERSION, items }, added, updated };
}

export function parseDataset(json: string): Dataset {
  const data = JSON.parse(json) as Dataset;
  if (data.version !== DATASET_VERSION || !Array.isArray(data.items)) {
    throw new Error(`Непідтримуваний формат датасету (очікується version ${DATASET_VERSION}).`);
  }
  return data;
}
