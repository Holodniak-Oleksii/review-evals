import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectCommands, resolveCommands } from '../src/core';

const dirs: string[] = [];

function project(pkg: object, files: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-evals-config-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const file of files) writeFileSync(join(dir, file), '');
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('detectCommands', () => {
  it('pnpm-проєкт зі скриптом typecheck, ESLint і Vitest', () => {
    const dir = project({
      packageManager: 'pnpm@12.18.0',
      scripts: { typecheck: 'next typegen && tsc --noEmit' },
      devDependencies: { typescript: '^5', eslint: '^9', vitest: '^5' },
    });

    expect(detectCommands(dir)).toEqual({
      typecheck: 'pnpm run typecheck',
      lint: 'pnpm exec eslint',
      test: 'pnpm exec vitest related --run --passWithNoTests --reporter=json --outputFile={report} {files}',
    });
  });

  it('npm-проєкт без скриптів і з Jest', () => {
    const dir = project({ devDependencies: { typescript: '^5', jest: '^30' } });

    expect(detectCommands(dir)).toEqual({
      typecheck: 'npm exec --no -- tsc --noEmit',
      lint: null,
      test: 'npm exec --no -- jest --findRelatedTests --passWithNoTests --json --outputFile={report} {files}',
    });
  });

  it('визначає yarn за lock-файлом', () => {
    const dir = project({ devDependencies: { eslint: '^9' } }, ['yarn.lock']);

    expect(detectCommands(dir).lint).toBe('yarn run eslint');
  });

  it('без package.json вимикає все', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-evals-config-'));
    dirs.push(dir);

    expect(detectCommands(dir)).toEqual({ typecheck: null, lint: null, test: null });
  });
});

describe('resolveCommands', () => {
  const detected = { typecheck: 'tsc', lint: 'eslint', test: 'vitest' };

  it('порожнє значення залишає автовизначене, off вимикає, інше замінює', () => {
    expect(resolveCommands(detected, { typecheck: '', lint: 'off', test: 'pnpm test' })).toEqual({
      typecheck: 'tsc',
      lint: null,
      test: 'pnpm test',
    });
  });
});
