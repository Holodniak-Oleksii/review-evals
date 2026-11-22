import { describe, expect, it } from 'vitest';
import { added } from '../src/core/checks/diff';
import { parseEslintJson } from '../src/core/checks/eslint';
import { outputTail, stripAnsi } from '../src/core/checks/output';
import { compareTests, parseTestReport } from '../src/core/checks/test-report';
import { parseTscOutput, tscKey } from '../src/core/checks/tsc';

describe('parseTscOutput', () => {
  it('розбирає звичайний, pretty і глобальний формати', () => {
    const output = [
      '> pampojo@0.1.0 typecheck',
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "\u001b[96msrc/b.tsx\u001b[0m:10:5 - \u001b[91merror\u001b[0m \u001b[90mTS2304: \u001b[0mCannot find name 'foo'.",
      'error TS5083: Cannot read file tsconfig.json.',
      ' ELIFECYCLE  Command failed with exit code 2.',
    ].join('\n');

    expect(parseTscOutput(stripAnsi(output))).toEqual([
      { file: 'src/a.ts', line: 3, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." },
      { file: 'src/b.tsx', line: 10, code: 'TS2304', message: "Cannot find name 'foo'." },
      { file: '', line: 0, code: 'TS5083', message: 'Cannot read file tsconfig.json.' },
    ]);
  });

  it('ключ не залежить від номера рядка', () => {
    const [a] = parseTscOutput('src/a.ts(3,7): error TS1: x');
    const [b] = parseTscOutput('src/a.ts(9,1): error TS1: x');
    expect(tscKey(a!)).toBe(tscKey(b!));
  });
});

describe('added', () => {
  it('рахує лише нові елементи з урахуванням повторів', () => {
    expect(added(['a', 'b', 'b'], ['b', 'a', 'b', 'b', 'c'], (x) => x)).toEqual(['b', 'c']);
  });
});

describe('parseEslintJson', () => {
  it('робить шляхи відносними до кореня', () => {
    const stdout = JSON.stringify([
      {
        filePath: '/private/tmp/wt/src/a.ts',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: "'x' is unused.", line: 3 },
          { ruleId: null, severity: 2, message: 'Parsing error', line: 1 },
          { ruleId: 'eqeqeq', severity: 1, message: 'Use ===', line: 5 },
          { ruleId: 'x', severity: 0, message: 'off', line: 1 },
        ],
      },
    ]);

    expect(parseEslintJson(stdout, ['/tmp/wt', '/private/tmp/wt'])).toEqual([
      { file: 'src/a.ts', line: 3, ruleId: 'no-unused-vars', severity: 2, message: "'x' is unused." },
      { file: 'src/a.ts', line: 1, ruleId: 'parse-error', severity: 2, message: 'Parsing error' },
      { file: 'src/a.ts', line: 5, ruleId: 'eqeqeq', severity: 1, message: 'Use ===' },
    ]);
  });

  it('повертає undefined, якщо JSON немає', () => {
    expect(parseEslintJson('Oops! Something went wrong', ['/tmp'])).toBeUndefined();
  });
});

describe('outputTail', () => {
  it('бере останні рядки без ANSI і зворотних лапок', () => {
    const tail = outputTail({
      command: 'x',
      exitCode: 1,
      stdout: 'one\n\u001b[31mtwo `code`\u001b[0m\n',
      stderr: 'three\n',
      timedOut: false,
      durationMs: 1,
    });
    expect(tail).toBe("two 'code' three");
  });
});

describe('parseTestReport і compareTests', () => {
  const json = JSON.stringify({
    testResults: [
      {
        name: '/wt/src/__tests__/a.test.ts',
        status: 'failed',
        assertionResults: [
          { fullName: 'a > works', status: 'passed' },
          { fullName: 'a > db', status: 'failed' },
          { fullName: 'a > todo', status: 'todo' },
        ],
      },
      { name: '/wt/src/__tests__/b.test.ts', status: 'failed', assertionResults: [] },
    ],
  });

  it('розбирає звіт Vitest/Jest і додає падіння файлу без тестів', () => {
    expect(parseTestReport(json, ['/wt'])).toEqual([
      { id: 'src/__tests__/a.test.ts > a > works', status: 'passed' },
      { id: 'src/__tests__/a.test.ts > a > db', status: 'failed' },
      { id: 'src/__tests__/a.test.ts > a > todo', status: 'skipped' },
      { id: 'src/__tests__/b.test.ts > (файл тестів)', status: 'failed' },
    ]);
    expect(parseTestReport('not json', ['/wt'])).toBeUndefined();
  });

  it('знаходить зламані й виправлені тести', () => {
    const before = [
      { id: 'x', status: 'passed' as const },
      { id: 'y', status: 'failed' as const },
      { id: 'z', status: 'failed' as const },
    ];
    const after = [
      { id: 'x', status: 'failed' as const },
      { id: 'y', status: 'passed' as const },
      { id: 'z', status: 'failed' as const },
      { id: 'new', status: 'failed' as const },
    ];
    expect(compareTests(before, after)).toEqual({
      broken: ['x', 'new'],
      fixed: ['y'],
      passingAfter: 1,
      failingBefore: 2,
      total: 4,
    });
  });
});
