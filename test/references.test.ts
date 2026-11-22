import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReferencesGrader, extractReferences, type Workspace } from '../src/core';
import { makeRecommendation } from './helpers';

describe('extractReferences', () => {
  it('бере імена, виклики, JSX, імпорти, шляхи і пропускає suggestion', () => {
    const body = [
      '[minor] Use `formatDate()` instead of `new Date().toString()`.',
      'Also `user?.profile.name` and `<Button />` look wrong; see `src/lib/date.ts` and `@/lib/date`.',
      '`const` and `null` are not references. `pnpm lint` is a command.',
      '```ts',
      "import { z } from 'zod';",
      'const unknownName = 1;',
      '```',
      '```suggestion',
      "import { hidden } from 'hidden-package';",
      '```',
    ].join('\n');

    expect(extractReferences(body)).toEqual([
      { kind: 'module', text: 'zod', specifier: 'zod' },
      { kind: 'symbol', text: 'formatDate', path: ['formatDate'] },
      { kind: 'symbol', text: 'user.profile.name', path: ['user', 'profile', 'name'] },
      { kind: 'symbol', text: 'Button', path: ['Button'] },
      { kind: 'file', text: 'src/lib/date.ts', path: 'src/lib/date.ts' },
      { kind: 'module', text: '@/lib/date', specifier: '@/lib/date' },
    ]);
  });

  it('повертає порожній список для коментаря без коду', () => {
    expect(extractReferences('Please add a test here.')).toEqual([]);
  });
});

describe('references з TypeScript API', () => {
  let dir: string;
  let workspace: Workspace;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'review-evals-refs-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ['es2023', 'dom'], types: [] }, include: ['src'] }),
    );
    writeFileSync(
      join(dir, 'src/user.ts'),
      [
        'export interface User { name: string; tags: string[] }',
        'export function loadUser(): User {',
        "  return { name: 'a', tags: [] };",
        '}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'src/app.ts'),
      [
        "import { loadUser } from './user';",
        'const user = loadUser();',
        'export const label = user.name.toUpperCase();',
        'export const sorted = user.tags.toSorted();',
        "window.addEventListener('online', () => undefined);",
      ].join('\n'),
    );
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    workspace = {
      checkout: async () => dir,
      prepare: async () => ({ ok: false, status: 'skip', reason: 'не потрібно' }),
      run: async (_d, command) => ({ command, exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 }),
    };
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const grade = (body: string) =>
    createReferencesGrader().grade(
      makeRecommendation({ path: 'src/app.ts', startLine: 3, endLine: 3, body, commitId: 'abc' }),
      { repoDir: dir, workspace },
    );

  it('pass, якщо всі посилання існують', async () => {
    const result = await grade(
      "Use `user.name.trim()`, `user.tags.toSorted`, `loadUser`, `Array.prototype.at`, `./user`, `src/user.ts` and `import { readFile } from 'node:fs/promises'`.",
    );
    expect(result).toMatchObject({ status: 'pass', score: 1 });
    expect(result.evidence).toContain('Усі посилання є в коді (7)');
  }, 60_000);

  it('fail для вигаданих імен, полів, модулів і файлів', async () => {
    const result = await grade(
      "Call `formatUser()`, read `user.fullName`, import `./helpers` and open `src/missing.ts`; `loadUser` is fine.",
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBeCloseTo(1 / 5);
    expect(result.evidence).toBe(
      'Не знайдено в коді: `user.fullName`, `./helpers`, `src/missing.ts`. ' +
        'Немає в коді (можливо, нові імена): `formatUser`. Знайдено 1 з 5 посилань.',
    );
  }, 60_000);

  it('нове ім\'я поряд з існуючими знижує оцінку, але не дає fail', async () => {
    const result = await grade('`loadUser` also listens for `online`, so rename `label` to `warmLabel`.');
    expect(result).toMatchObject({ status: 'pass' });
    expect(result.score).toBeCloseTo(3 / 4);
    expect(result.evidence).toBe('Знайдено 3 з 4 посилань. Немає в коді (можливо, нові імена): `warmLabel`.');
  }, 60_000);

  it('fail, якщо жодне ім\'я не знайдено', async () => {
    const result = await grade('Use `formatUserName` from `userFormatter`.');
    expect(result).toMatchObject({ status: 'fail', score: 0 });
  }, 60_000);

  it('skip, якщо посилань немає', async () => {
    expect((await grade('Looks good to me.')).status).toBe('skip');
  });
});
