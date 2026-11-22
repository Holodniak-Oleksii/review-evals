import { added } from '../checks/diff';
import { combinedOutput, outputTail } from '../checks/output';
import { formatTscDiagnostic, parseTscOutput, tscKey } from '../checks/tsc';
import type { Grader } from '../types';
import { result, runBeforeAfter, runExecutionCheck, shorten, timeoutResult } from './execution';

const NAME = 'typecheck';

export function createTypecheckGrader(command: string | null): Grader {
  return {
    name: NAME,
    kind: 'execution',
    grade: (rec, ctx) =>
      runExecutionCheck(NAME, command, rec, ctx, async (sandbox, workspace) => {
        const { before, after } = await runBeforeAfter(workspace, sandbox, command ?? '');
        const timeout = timeoutResult(NAME, before, after);
        if (timeout) return timeout;

        const beforeDiagnostics = parseTscOutput(combinedOutput(before));
        const afterDiagnostics = parseTscOutput(combinedOutput(after));

        if (before.exitCode !== 0 && beforeDiagnostics.length === 0) {
          return result(NAME, 'skip', 0, `Перевірка типів не працює навіть без зміни: ${outputTail(before)}`);
        }

        const introduced = added(beforeDiagnostics, afterDiagnostics, tscKey);
        if (introduced.length > 0) {
          const first = shorten(formatTscDiagnostic(introduced[0]!));
          return result(NAME, 'fail', 0, `Зміна додає помилок TypeScript: ${introduced.length}. Перша: ${first}`);
        }
        if (after.exitCode !== 0 && before.exitCode === 0) {
          return result(NAME, 'fail', 0, `Після зміни перевірка типів завершилась з помилкою: ${outputTail(after)}`);
        }

        const fixed = added(afterDiagnostics, beforeDiagnostics, tscKey);
        if (fixed.length > 0) {
          return result(NAME, 'pass', 1, `Зміна виправляє помилок TypeScript: ${fixed.length} і не додає нових.`);
        }
        return result(NAME, 'pass', 1, 'Зміна не додає помилок TypeScript.');
      }),
  };
}
