import { relativeTo } from './paths';

export interface EslintProblem {
  file: string;
  line: number;
  ruleId: string;
  severity: 1 | 2;
  message: string;
}

interface EslintFileResult {
  filePath: string;
  messages: Array<{ ruleId: string | null; severity: number; message: string; line?: number }>;
}

export function parseEslintJson(stdout: string, rootDirs: readonly string[]): EslintProblem[] | undefined {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end < start) return undefined;

  let results: unknown;
  try {
    results = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(results)) return undefined;

  const problems: EslintProblem[] = [];
  for (const result of results as EslintFileResult[]) {
    const file = relativeTo(rootDirs, result.filePath);
    for (const message of result.messages ?? []) {
      if (message.severity !== 1 && message.severity !== 2) continue;
      problems.push({
        file,
        line: message.line ?? 0,
        ruleId: message.ruleId ?? 'parse-error',
        severity: message.severity,
        message: message.message,
      });
    }
  }
  return problems;
}

export function eslintKey(problem: EslintProblem): string {
  return `${problem.file}\0${problem.ruleId}\0${problem.severity}\0${problem.message}`;
}

export function formatEslintProblem(problem: EslintProblem): string {
  return `${problem.ruleId} у ${problem.file}:${problem.line}: ${problem.message}`;
}
