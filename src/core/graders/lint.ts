import { added } from '../checks/diff';
import { eslintKey, formatEslintProblem, parseEslintJson, type EslintProblem } from '../checks/eslint';
import { outputTail } from '../checks/output';
import { rootDirs } from '../checks/paths';
import type { Grader } from '../types';
import { result, runBeforeAfter, runExecutionCheck, shellQuote, shorten, timeoutResult } from './execution';

const NAME = 'lint';

export function createLintGrader(command: string | null): Grader {
  return {
    name: NAME,
    kind: 'execution',
    grade: (rec, ctx) =>
      runExecutionCheck(NAME, command, rec, ctx, async (sandbox, workspace) => {
        const files = sandbox.files.map(shellQuote).join(' ');
        const { before, after } = await runBeforeAfter(workspace, sandbox, `${command} --format json -- ${files}`);
        const timeout = timeoutResult(NAME, before, after);
        if (timeout) return timeout;

        const beforeProblems = parseEslintJson(before.stdout, rootDirs(sandbox.before));
        if (!beforeProblems) {
          return result(NAME, 'skip', 0, `ESLint не працює навіть без зміни: ${outputTail(before)}`);
        }
        const afterProblems = parseEslintJson(after.stdout, rootDirs(sandbox.after));
        if (!afterProblems) {
          return result(NAME, 'fail', 0, `Після зміни ESLint завершився з помилкою: ${outputTail(after)}`);
        }

        const newErrors = added(errors(beforeProblems), errors(afterProblems), eslintKey);
        if (newErrors.length > 0) {
          const first = shorten(formatEslintProblem(newErrors[0]!));
          return result(NAME, 'fail', 0, `Зміна додає помилок ESLint: ${newErrors.length}. Перша: ${first}`);
        }

        const newWarnings = added(warnings(beforeProblems), warnings(afterProblems), eslintKey);
        if (newWarnings.length > 0) {
          const first = shorten(formatEslintProblem(newWarnings[0]!));
          return result(NAME, 'pass', 0.5, `Зміна додає попереджень ESLint: ${newWarnings.length}. Перше: ${first}`);
        }

        const fixed = added(afterProblems, beforeProblems, eslintKey);
        if (fixed.length > 0) {
          return result(NAME, 'pass', 1, `Зміна прибирає проблем ESLint: ${fixed.length} і не додає нових.`);
        }
        return result(NAME, 'pass', 1, 'Зміна не додає проблем ESLint.');
      }),
  };
}

function errors(problems: EslintProblem[]): EslintProblem[] {
  return problems.filter((problem) => problem.severity === 2);
}

function warnings(problems: EslintProblem[]): EslintProblem[] {
  return problems.filter((problem) => problem.severity === 1);
}
