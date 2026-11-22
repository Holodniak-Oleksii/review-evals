import { seconds } from '../checks/output';
import type {
  CommandResult,
  EvalContext,
  GradeResult,
  GradeStatus,
  Recommendation,
  Sandbox,
  Workspace,
} from '../types';

const CODE_FILE = /\.[cm]?[jt]sx?$/i;

export type ExecutionCheck = (sandbox: Sandbox, workspace: Workspace) => Promise<GradeResult>;

export function result(grader: string, status: GradeStatus, score: number, evidence: string): GradeResult {
  return { grader, status, score, evidence };
}

export async function runExecutionCheck(
  grader: string,
  command: string | null,
  rec: Recommendation,
  ctx: EvalContext,
  check: ExecutionCheck,
): Promise<GradeResult> {
  if (rec.suggestion === undefined) return result(grader, 'skip', 0, 'Немає блоку suggestion, нічого запускати.');
  if (command === null) return result(grader, 'skip', 0, 'Команду для цієї перевірки не задано.');
  if (!ctx.workspace) return result(grader, 'skip', 0, 'Виконання коду не налаштовано.');

  const prepared = await ctx.workspace.prepare(rec);
  if (!prepared.ok) return result(grader, 'skip', 0, `Перевірку не запущено: ${prepared.reason}.`);
  if (!prepared.sandbox.files.some((file) => CODE_FILE.test(file))) {
    return result(grader, 'skip', 0, 'Змінений файл не є кодом JavaScript/TypeScript.');
  }

  return check(prepared.sandbox, ctx.workspace);
}

export async function runBeforeAfter(
  workspace: Workspace,
  sandbox: Sandbox,
  command: string,
): Promise<{ before: CommandResult; after: CommandResult }> {
  const before = await workspace.run(sandbox.before, command);
  const after = await workspace.run(sandbox.after, command);
  return { before, after };
}

export function timeoutResult(grader: string, ...runs: CommandResult[]): GradeResult | undefined {
  const slow = runs.find((run) => run.timedOut);
  if (!slow) return undefined;
  return result(grader, 'skip', 0, `Перевищено ліміт часу: команда працювала ${seconds(slow.durationMs)}.`);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shorten(text: string, maxLength = 200): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > maxLength ? `${single.slice(0, maxLength - 1)}…` : single;
}
