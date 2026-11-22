import type { ExecutionCommands } from './config';
import { renderData } from './data';
import { MARKER } from './marker';
import type { Mode } from './mode';
import type { AggregationMethod, Evaluation, GradeStatus, Recommendation, RecommendationSource, TrustLevel, TrustScore } from './types';

const STATUS_ICON: Record<GradeStatus, string> = {
  pass: '✔',
  fail: '✘',
  skip: '–',
};

const SOURCE_LABEL: Record<RecommendationSource, string> = {
  llm: 'LLM',
  human: 'людина',
};

const LEVEL_LABEL: Record<TrustLevel, string> = {
  high: 'висока',
  medium: 'сумнівна',
  low: 'низька',
};

const METHOD_LABEL: Record<AggregationMethod, string> = {
  rules: 'правила',
  logistic: 'логістична регресія',
};

export interface ReplyOptions {
  minimized?: boolean;
  minTrust?: number;
}

export function formatLocation(rec: Recommendation): string {
  const end = rec.endLine;
  if (end === null) return rec.path;
  const start = rec.startLine ?? end;
  return start === end ? `${rec.path}:${end}` : `${rec.path}:${start}-${end}`;
}

export function formatSource(rec: Recommendation): string {
  return `${SOURCE_LABEL[rec.source]} (\`${rec.author}\`)`;
}

export function renderReply(evaluation: Evaluation, options: ReplyOptions = {}): string {
  const { recommendation: rec, results, trust } = evaluation;
  const checklist =
    results.length > 0
      ? results.map((r) => `- ${STATUS_ICON[r.status]} \`${r.grader}\` — ${r.evidence}`)
      : ['- Немає жодного оцінювача.'];

  return [
    MARKER,
    '**Review Evals** — автоматична перевірка рекомендації',
    '',
    `Джерело: **${formatSource(rec)}**${rec.severity ? ` · тег \`${rec.severity}\`` : ''}`,
    ...(trust ? renderTrust(trust) : []),
    ...(options.minimized ? [`Коментар згорнуто: довіра нижче порогу ${(options.minTrust ?? 0).toFixed(2)}.`] : []),
    '',
    ...checklist,
    ...generatedSuggestion(rec),
    '',
    '<sub>✔ пройдено · ✘ не пройдено · – не застосовується</sub>',
    '',
    renderData(evaluation),
  ].join('\n');
}

export function formatTrust(trust: TrustScore): string {
  return `${trust.score.toFixed(2)} ${LEVEL_LABEL[trust.level]}`;
}

function renderTrust(trust: TrustScore): string[] {
  const veto = trust.veto ? ` · обмежено через ✘ \`${trust.veto}\`` : '';
  const lines = [`Оцінка довіри: **${trust.score.toFixed(2)}** — ${LEVEL_LABEL[trust.level]} (${METHOD_LABEL[trust.method]})${veto}`];
  if (trust.factors.length > 0) {
    lines.push(`Головні чинники: ${trust.factors.map((f) => `${formatFeature(f.feature)} ${signed(f.contribution)}`).join(' · ')}`);
  }
  return lines;
}

function formatFeature(feature: string): string {
  const [grader, outcome] = feature.split(':');
  if (outcome === 'pass') return `✔ ${grader}`;
  if (outcome === 'fail') return `✘ ${grader}`;
  return feature;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
}

function generatedSuggestion(rec: Recommendation): string[] {
  if (rec.suggestionOrigin !== 'model' || rec.suggestion === undefined) return [];
  const longest = Math.max(2, ...[...rec.suggestion.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return [
    '',
    '<details>',
    `<summary>Зміна, яку згенерував LLM для ${formatLocation(rec)}</summary>`,
    '',
    fence,
    rec.suggestion,
    fence,
    '',
    '</details>',
  ];
}

export type SummaryEntry = Evaluation & { minimized?: boolean };

export interface RunSummary {
  pullNumber: number;
  mode: Mode;
  evaluations: SummaryEntry[];
  alreadyEvaluated: number;
  failed: number;
  commands?: ExecutionCommands;
  aggregation?: string;
}

export function renderSummary(summary: RunSummary): string {
  const stats = [
    `Режим: \`${summary.mode}\`.`,
    `Оцінено нових коментарів: ${summary.evaluations.length}.`,
    `Вже оцінено раніше: ${summary.alreadyEvaluated}.`,
  ];
  const minimized = summary.evaluations.filter((entry) => entry.minimized).length;
  if (minimized > 0) stats.push(`Згорнуто: ${minimized}.`);
  if (summary.failed > 0) stats.push(`Помилок: ${summary.failed}.`);

  const lines = [`## Review Evals — PR #${summary.pullNumber}`, '', stats.join(' '), ''];
  if (summary.commands) lines.push(renderCommands(summary.commands), '');
  if (summary.aggregation) lines.push(`Агрегація: ${summary.aggregation}.`, '');

  if (summary.evaluations.length === 0) {
    lines.push('_Нових коментарів для оцінювання немає._');
    return lines.join('\n');
  }

  lines.push('| Файл:рядки | Джерело | Довіра | Результати оцінювачів |', '| --- | --- | --- | --- |');
  for (const { recommendation: rec, results, trust, minimized: hidden } of summary.evaluations) {
    const location = `\`${formatLocation(rec)}\``;
    const locationCell = rec.url ? `[${location}](${rec.url})` : location;
    const trustCell = trust ? `${formatTrust(trust)}${hidden ? '<br>згорнуто' : ''}` : '—';
    const resultsCell = results.map((r) => `${STATUS_ICON[r.status]} ${r.grader}`).join('<br>') || '—';
    lines.push(`| ${cell(locationCell)} | ${cell(formatSource(rec))} | ${cell(trustCell)} | ${cell(resultsCell)} |`);
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
