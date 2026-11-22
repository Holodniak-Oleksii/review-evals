import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { combinedOutput, outputTail } from '../checks/output';
import { rootDirs } from '../checks/paths';
import { compareTests, parseTestReport, type TestCase } from '../checks/test-report';
import type { CommandResult, GradeResult, Grader } from '../types';
import { result, runBeforeAfter, runExecutionCheck, shellQuote, shorten, timeoutResult } from './execution';

const NAME = 'tests';
const REPORT_FILE = 'review-evals-tests.json';
const NO_TESTS = /no test files found|no tests found/i;

export function createTestsGrader(command: string | null): Grader {
  return {
    name: NAME,
    kind: 'execution',
    grade: (rec, ctx) =>
      runExecutionCheck(NAME, command, rec, ctx, async (sandbox, workspace) => {
        const template = command ?? '';
        const files = sandbox.files.map(shellQuote).join(' ');
        const fullCommand = template.replaceAll('{files}', files).replaceAll('{report}', REPORT_FILE);
        const { before, after } = await runBeforeAfter(workspace, sandbox, fullCommand);
        const timeout = timeoutResult(NAME, before, after);
        if (timeout) return timeout;

        if (hasNoTests(before) && hasNoTests(after)) return noRelatedTests();

        if (template.includes('{report}')) {
          const beforeTests = await readReport(sandbox.before);
          const afterTests = await readReport(sandbox.after);
          if (beforeTests && afterTests) return judgeReports(beforeTests, afterTests);
        }
        return judgeExitCodes(before, after);
      }),
  };
}

function judgeReports(before: TestCase[], after: TestCase[]): GradeResult {
  if (before.length === 0 && after.length === 0) return noRelatedTests();

  const comparison = compareTests(before, after);
  if (comparison.broken.length > 0) {
    const first = shorten(comparison.broken[0]!);
    return result(NAME, 'fail', 0, `Зміна ламає тестів: ${comparison.broken.length}. Перший: ${first}`);
  }
  if (comparison.passingAfter === 0) {
    return result(
      NAME,
      'skip',
      0,
      `Жоден пов'язаний тест не проходить навіть без зміни (падають: ${comparison.failingBefore}).`,
    );
  }

  const note =
    comparison.failingBefore > 0 ? ` Ще до зміни падали: ${comparison.failingBefore}, їх не враховано.` : '';
  if (comparison.fixed.length > 0) {
    return result(NAME, 'pass', 1, `Зміна виправляє тестів: ${comparison.fixed.length}, нових падінь немає.${note}`);
  }
  return result(
    NAME,
    'pass',
    1,
    `Тести проходять: ${comparison.passingAfter} з ${comparison.total}, нових падінь немає.${note}`,
  );
}

function judgeExitCodes(before: CommandResult, after: CommandResult): GradeResult {
  const passedBefore = before.exitCode === 0;
  const passedAfter = after.exitCode === 0;
  if (passedBefore && passedAfter) return result(NAME, 'pass', 1, 'Тести проходять до і після зміни.');
  if (passedBefore) return result(NAME, 'fail', 0, `Зміна ламає тести: ${outputTail(after)}`);
  if (passedAfter) return result(NAME, 'pass', 1, 'Зміна виправляє тести, які падали до неї.');
  return result(NAME, 'skip', 0, `Тести падали ще до зміни: ${outputTail(before)}`);
}

function noRelatedTests(): GradeResult {
  return result(NAME, 'skip', 0, "Немає тестів, пов'язаних зі зміненим файлом.");
}

async function readReport(dir: string): Promise<TestCase[] | undefined> {
  try {
    return parseTestReport(await readFile(join(dir, REPORT_FILE), 'utf8'), rootDirs(dir));
  } catch {
    return undefined;
  }
}

function hasNoTests(run: CommandResult): boolean {
  return NO_TESTS.test(combinedOutput(run));
}
