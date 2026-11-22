import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLintGrader,
  createTestsGrader,
  createTypecheckGrader,
  suggestionApplies,
  type CommandResult,
  type SandboxResult,
  type Workspace,
} from '../src/core';
import { makeRecommendation } from './helpers';

type Outputs = Record<string, Partial<CommandResult>>;

class FakeWorkspace implements Workspace {
  readonly commands: string[] = [];

  constructor(
    private readonly prepared: SandboxResult,
    private readonly outputs: Outputs = { before: {}, after: {} },
  ) {}

  async prepare(): Promise<SandboxResult> {
    return this.prepared;
  }

  async run(dir: string, command: string): Promise<CommandResult> {
    this.commands.push(`${dir}: ${command}`);
    return {
      command,
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 10,
      ...this.outputs[dir],
    };
  }
}

const ready: SandboxResult = { ok: true, sandbox: { before: 'before', after: 'after', files: ['src/a.ts'] } };
const rec = makeRecommendation({ suggestion: 'const x = 1;' });

function ctxWith(workspace?: Workspace) {
  return { repoDir: '/repo', workspace };
}

describe('suggestion-applies', () => {
  it('pass, якщо suggestion застосовується', async () => {
    const result = await suggestionApplies.grade(rec, ctxWith(new FakeWorkspace(ready)));
    expect(result).toMatchObject({ status: 'pass', score: 1, evidence: 'Suggestion застосовується до src/App.tsx:10.' });
  });

  it('передає статус і причину з робочої теки', async () => {
    const workspace = new FakeWorkspace({ ok: false, status: 'fail', reason: 'рядки 4-5 виходять за межі файлу' });
    const result = await suggestionApplies.grade(rec, ctxWith(workspace));
    expect(result).toMatchObject({ status: 'fail', score: 0, evidence: 'Рядки 4-5 виходять за межі файлу.' });
  });

  it('skip без suggestion або без робочої теки', async () => {
    expect((await suggestionApplies.grade(makeRecommendation(), ctxWith(new FakeWorkspace(ready)))).status).toBe('skip');
    expect((await suggestionApplies.grade(rec, ctxWith())).status).toBe('skip');
  });
});

describe('typecheck', () => {
  const grader = createTypecheckGrader('pnpm run typecheck');
  const error = (line: number, message = "Type 'string' is not assignable to type 'number'.") =>
    `src/a.ts(${line},1): error TS2322: ${message}`;

  it('fail, якщо зміна додає помилку', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 0 },
      after: { exitCode: 2, stdout: error(3) },
    });
    const result = await grader.grade(rec, ctxWith(workspace));
    expect(result.status).toBe('fail');
    expect(result.evidence).toContain('Зміна додає помилок TypeScript: 1. Перша: TS2322 у src/a.ts:3');
  });

  it('pass, якщо старі помилки лише змістилися', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 2, stdout: error(3) },
      after: { exitCode: 2, stdout: error(4) },
    });
    expect(await grader.grade(rec, ctxWith(workspace))).toMatchObject({ status: 'pass', score: 1 });
  });

  it('pass з поясненням, якщо зміна виправляє помилку', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 2, stdout: error(3) },
      after: { exitCode: 0 },
    });
    const result = await grader.grade(rec, ctxWith(workspace));
    expect(result.evidence).toBe('Зміна виправляє помилок TypeScript: 1 і не додає нових.');
  });

  it('skip, якщо команда не працює навіть без зміни', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 127, stderr: 'sh: tsc: command not found' },
      after: { exitCode: 127, stderr: 'sh: tsc: command not found' },
    });
    const result = await grader.grade(rec, ctxWith(workspace));
    expect(result.status).toBe('skip');
    expect(result.evidence).toContain('command not found');
  });

  it('skip при таймауті', async () => {
    const workspace = new FakeWorkspace(ready, { before: {}, after: { timedOut: true, exitCode: null, durationMs: 300_000 } });
    const result = await grader.grade(rec, ctxWith(workspace));
    expect(result).toMatchObject({ status: 'skip', evidence: 'Перевищено ліміт часу: команда працювала 300 с.' });
  });

  it('skip, якщо змінено не код', async () => {
    const docs: SandboxResult = { ok: true, sandbox: { before: 'before', after: 'after', files: ['README.md'] } };
    const result = await grader.grade(rec, ctxWith(new FakeWorkspace(docs)));
    expect(result.status).toBe('skip');
  });

  it('skip, якщо команду вимкнено', async () => {
    const result = await createTypecheckGrader(null).grade(rec, ctxWith(new FakeWorkspace(ready)));
    expect(result).toMatchObject({ status: 'skip', evidence: 'Команду для цієї перевірки не задано.' });
  });
});

describe('lint', () => {
  const grader = createLintGrader('pnpm exec eslint');
  const report = (dir: string, ...messages: Array<{ ruleId: string; severity: number; line?: number }>) =>
    JSON.stringify([
      { filePath: `${dir}/src/a.ts`, messages: messages.map((m) => ({ message: `${m.ruleId} problem`, line: 1, ...m })) },
    ]);

  it('додає --format json і змінений файл до команди', async () => {
    const workspace = new FakeWorkspace(ready, { before: { stdout: report('before') }, after: { stdout: report('after') } });
    await grader.grade(rec, ctxWith(workspace));
    expect(workspace.commands).toEqual([
      "before: pnpm exec eslint --format json -- 'src/a.ts'",
      "after: pnpm exec eslint --format json -- 'src/a.ts'",
    ]);
  });

  it('fail для нової помилки, 0.5 для нового попередження', async () => {
    const withError = new FakeWorkspace(ready, {
      before: { stdout: report('before') },
      after: { exitCode: 1, stdout: report('after', { ruleId: 'no-unused-vars', severity: 2 }) },
    });
    expect(await grader.grade(rec, ctxWith(withError))).toMatchObject({ status: 'fail', score: 0 });

    const withWarning = new FakeWorkspace(ready, {
      before: { stdout: report('before') },
      after: { stdout: report('after', { ruleId: 'eqeqeq', severity: 1 }) },
    });
    expect(await grader.grade(rec, ctxWith(withWarning))).toMatchObject({ status: 'pass', score: 0.5 });
  });

  it('pass, якщо зміна прибирає проблему', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 1, stdout: report('before', { ruleId: 'no-unused-vars', severity: 2, line: 3 }) },
      after: { stdout: report('after') },
    });
    expect(await grader.grade(rec, ctxWith(workspace))).toMatchObject({
      status: 'pass',
      score: 1,
      evidence: 'Зміна прибирає проблем ESLint: 1 і не додає нових.',
    });
  });

  it('skip, якщо ESLint не працює без зміни', async () => {
    const workspace = new FakeWorkspace(ready, {
      before: { exitCode: 2, stderr: 'Oops! Something went wrong!' },
      after: { exitCode: 2, stderr: 'Oops! Something went wrong!' },
    });
    expect((await grader.grade(rec, ctxWith(workspace))).status).toBe('skip');
  });
});

describe('tests', () => {
  const grader = createTestsGrader('pnpm exec vitest related --run {files}');
  const check = (before: number, after: number) =>
    grader.grade(rec, ctxWith(new FakeWorkspace(ready, { before: { exitCode: before }, after: { exitCode: after } })));

  it('підставляє змінені файли замість {files}', async () => {
    const workspace = new FakeWorkspace(ready);
    await grader.grade(rec, ctxWith(workspace));
    expect(workspace.commands[0]).toBe("before: pnpm exec vitest related --run 'src/a.ts'");
  });

  it('порівнює результат до і після зміни', async () => {
    expect(await check(0, 0)).toMatchObject({ status: 'pass', evidence: 'Тести проходять до і після зміни.' });
    expect(await check(0, 1)).toMatchObject({ status: 'fail', score: 0 });
    expect(await check(1, 0)).toMatchObject({ status: 'pass', evidence: 'Зміна виправляє тести, які падали до неї.' });
    expect(await check(1, 1)).toMatchObject({ status: 'skip' });
  });

  it('skip, якщо пов\'язаних тестів немає', async () => {
    const noTests = { exitCode: 0, stdout: 'No test files found, exiting with code 0' };
    const workspace = new FakeWorkspace(ready, { before: noTests, after: noTests });
    expect(await grader.grade(rec, ctxWith(workspace))).toMatchObject({ status: 'skip' });
  });
});

describe('tests з JSON-звітом', () => {
  const grader = createTestsGrader('pnpm exec vitest related --run --reporter=json --outputFile={report} {files}');
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'review-evals-report-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function sandboxWithReports(before: object, after: object) {
    const dirs = { before: join(root, 'before'), after: join(root, 'after') };
    for (const [key, report] of [['before', before], ['after', after]] as const) {
      mkdirSync(dirs[key], { recursive: true });
      writeFileSync(join(dirs[key], 'review-evals-tests.json'), JSON.stringify(report));
    }
    const prepared: SandboxResult = { ok: true, sandbox: { ...dirs, files: ['src/a.ts'] } };
    return new FakeWorkspace(prepared, { [dirs.before]: { exitCode: 1 }, [dirs.after]: { exitCode: 1 } });
  }

  const report = (dir: string, tests: Record<string, string>) => ({
    testResults: [
      {
        name: join(root, dir, 'src/__tests__/a.test.ts'),
        status: Object.values(tests).includes('failed') ? 'failed' : 'passed',
        assertionResults: Object.entries(tests).map(([fullName, status]) => ({ fullName, status })),
      },
    ],
  });

  it('ігнорує тести, які падали ще до зміни', async () => {
    const workspace = sandboxWithReports(
      report('before', { 'pure works': 'passed', 'db query': 'failed' }),
      report('after', { 'pure works': 'passed', 'db query': 'failed' }),
    );
    expect(await grader.grade(rec, ctxWith(workspace))).toMatchObject({
      status: 'pass',
      evidence: 'Тести проходять: 1 з 2, нових падінь немає. Ще до зміни падали: 1, їх не враховано.',
    });
    expect(workspace.commands[0]).toContain('--outputFile=review-evals-tests.json');
  });

  it('fail, якщо тест проходив до зміни і падає після неї', async () => {
    const workspace = sandboxWithReports(
      report('before', { 'pure works': 'passed', 'db query': 'failed' }),
      report('after', { 'pure works': 'failed', 'db query': 'failed' }),
    );
    expect(await grader.grade(rec, ctxWith(workspace))).toMatchObject({
      status: 'fail',
      evidence: 'Зміна ламає тестів: 1. Перший: src/__tests__/a.test.ts > pure works',
    });
  });

  it('skip, якщо жоден тест не проходить навіть без зміни', async () => {
    const workspace = sandboxWithReports(report('before', { 'db query': 'failed' }), report('after', { 'db query': 'failed' }));
    expect((await grader.grade(rec, ctxWith(workspace))).status).toBe('skip');
  });
});
