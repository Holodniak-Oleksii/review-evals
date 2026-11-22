import type { ExecutionCommands } from './config';
import { MARKER } from './marker';
import type { Mode } from './mode';
import type { Evaluation, GradeStatus, Recommendation, RecommendationSource } from './types';

const STATUS_ICON: Record<GradeStatus, string> = {
  pass: '✔',
  fail: '✘',
  skip: '–',
};

const SOURCE_LABEL: Record<RecommendationSource, string> = {
  llm: 'LLM',
  human: 'людина',
};

export function formatLocation(rec: Recommendation): string {
  const end = rec.endLine;
  if (end === null) return rec.path;
  const start = rec.startLine ?? end;
  return start === end ? `${rec.path}:${end}` : `${rec.path}:${start}-${end}`;
}

export function formatSource(rec: Recommendation): string {
  return `${SOURCE_LABEL[rec.source]} (\`${rec.author}\`)`;
}

export function renderReply(evaluation: Evaluation): string {
  const { recommendation: rec, results } = evaluation;
  const checklist =
    results.length > 0
      ? results.map((r) => `- ${STATUS_ICON[r.status]} \`${r.grader}\` — ${r.evidence}`)
      : ['- Немає жодного оцінювача.'];

  return [
    MARKER,
    '**Review Evals** — автоматична перевірка рекомендації',
    '',
    `Джерело: **${formatSource(rec)}**`,
    '',
    ...checklist,
    '',
    '<sub>✔ пройдено · ✘ не пройдено · – не застосовується</sub>',
  ].join('\n');
}

export interface RunSummary {
  pullNumber: number;
  mode: Mode;
  evaluations: Evaluation[];
  alreadyEvaluated: number;
  failed: number;
  commands?: ExecutionCommands;
}

export function renderSummary(summary: RunSummary): string {
  const stats = [
    `Режим: \`${summary.mode}\`.`,
    `Оцінено нових коментарів: ${summary.evaluations.length}.`,
    `Вже оцінено раніше: ${summary.alreadyEvaluated}.`,
  ];
  if (summary.failed > 0) stats.push(`Помилок: ${summary.failed}.`);

  const lines = [`## Review Evals — PR #${summary.pullNumber}`, '', stats.join(' '), ''];
  if (summary.commands) lines.push(renderCommands(summary.commands), '');

  if (summary.evaluations.length === 0) {
    lines.push('_Нових коментарів для оцінювання немає._');
    return lines.join('\n');
  }

  lines.push('| Файл:рядки | Джерело | Результати оцінювачів |', '| --- | --- | --- |');
  for (const { recommendation: rec, results } of summary.evaluations) {
    const location = `\`${formatLocation(rec)}\``;
    const locationCell = rec.url ? `[${location}](${rec.url})` : location;
    const resultsCell = results.map((r) => `${STATUS_ICON[r.status]} ${r.grader}`).join('<br>') || '—';
    lines.push(`| ${cell(locationCell)} | ${cell(formatSource(rec))} | ${cell(resultsCell)} |`);
  }

  return lines.join('\n');
}

function renderCommands(commands: ExecutionCommands): string {
  const describe = (command: string | null) => (command ? `\`${command}\`` : 'вимкнено');
  return [
    `Команди: typecheck — ${describe(commands.typecheck)};`,
    `lint — ${describe(commands.lint)};`,
    `tests — ${describe(commands.test)}.`,
  ].join(' ');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
