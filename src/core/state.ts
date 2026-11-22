import { formatLocation } from './report';
import type { Evaluation } from './types';

export const STATE_MARKER = '<!-- review-evals-state -->';
const STATE_PREFIX = '<!-- review-evals-state-data ';
const STATE_SUFFIX = ' -->';
const STATE_VERSION = 1;

export interface StateEntry {
  trust: number;
  minimized: boolean;
  location: string;
  url?: string;
}

export interface PullRequestState {
  version: number;
  evaluated: Record<string, StateEntry>;
}

export function emptyState(): PullRequestState {
  return { version: STATE_VERSION, evaluated: {} };
}

export function isStateComment(body: string | null | undefined): boolean {
  return body?.includes(STATE_MARKER) ?? false;
}

export function parseState(body: string | null | undefined): PullRequestState {
  if (!body) return emptyState();
  const start = body.indexOf(STATE_PREFIX);
  const end = start === -1 ? -1 : body.indexOf(STATE_SUFFIX, start + STATE_PREFIX.length);
  if (start === -1 || end === -1) return emptyState();
  try {
    const data = JSON.parse(body.slice(start + STATE_PREFIX.length, end)) as PullRequestState;
    return data.version === STATE_VERSION && typeof data.evaluated === 'object' ? data : emptyState();
  } catch {
    return emptyState();
  }
}

export function recordEvaluation(state: PullRequestState, commentId: string, evaluation: Evaluation, minimized: boolean): void {
  const rec = evaluation.recommendation;
  state.evaluated[commentId] = {
    trust: evaluation.trust?.score ?? 0,
    minimized,
    location: formatLocation(rec),
    ...(rec.url ? { url: rec.url } : {}),
  };
}

export function renderState(state: PullRequestState, minTrust: number): string {
  const entries = Object.values(state.evaluated);
  const minimized = entries.filter((entry) => entry.minimized);
  const lines = [
    STATE_MARKER,
    `**Review Evals** · режим \`filter\`: згорнуто ${minimized.length} з ${entries.length} рекомендацій з довірою нижче ${minTrust.toFixed(2)}.`,
  ];
  if (minimized.length > 0) {
    lines.push('', '| Рекомендація | Довіра |', '| --- | --- |');
    for (const entry of minimized) {
      const location = `\`${entry.location.replace(/\|/g, '\\|')}\``;
      lines.push(`| ${entry.url ? `[${location}](${entry.url})` : location} | ${entry.trust.toFixed(2)} |`);
    }
  }
  const json = JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  lines.push('', `${STATE_PREFIX}${json}${STATE_SUFFIX}`);
  return lines.join('\n');
}
