import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTypecheckGrader, evaluate, GitWorkspace, suggestionApplies } from '../src/core';
import { makeRecommendation } from './helpers';

let root: string;
let repoDir: string;
let commit: string;
let workspace: GitWorkspace;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'review-evals-ws-'));
  repoDir = join(root, 'repo');
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, '.gitignore'), 'node_modules\n');
  writeFileSync(
    join(repoDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }),
  );
  writeFileSync(join(repoDir, 'src/a.ts'), 'export const n: number = 1;\nexport const s = "ok";\n');
  symlinkSync(resolve('node_modules'), join(repoDir, 'node_modules'), 'dir');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  commit = git('rev-parse', 'HEAD');
  workspace = new GitWorkspace({ repoDir, tempDir: join(root, 'worktrees'), timeoutMs: 60_000 });
});

afterAll(async () => {
  await workspace?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const rec = (id: string, suggestion: string, line = 1) =>
  makeRecommendation({ id, path: 'src/a.ts', startLine: line, endLine: line, suggestion, commitId: commit });

describe('GitWorkspace', () => {
  it('готує теки «до» і «після» з окремими worktree', async () => {
    const prepared = await workspace.prepare(rec('ok', 'export const n: number = 2;'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const { before, after, files } = prepared.sandbox;
    expect(files).toEqual(['src/a.ts']);
    expect(readFileSync(join(before, 'src/a.ts'), 'utf8')).toBe('export const n: number = 1;\nexport const s = "ok";\n');
    expect(readFileSync(join(after, 'src/a.ts'), 'utf8')).toBe('export const n: number = 2;\nexport const s = "ok";\n');
    expect(existsSync(join(after, 'node_modules', 'typescript'))).toBe(true);
    expect(readFileSync(join(repoDir, 'src/a.ts'), 'utf8')).toContain('= 1;');
  });

  it('використовує одну теку «до» для одного коміту', async () => {
    const a = await workspace.prepare(rec('a', 'export const n: number = 3;'));
    const b = await workspace.prepare(rec('b', 'export const n: number = 4;'));
    expect(a.ok && b.ok && a.sandbox.before === b.sandbox.before).toBe(true);
    expect(a.ok && b.ok && a.sandbox.after !== b.sandbox.after).toBe(true);
  });

  it('fail для рядків за межами файлу і для suggestion без змін', async () => {
    expect(await workspace.prepare(rec('range', 'x', 9))).toMatchObject({ ok: false, status: 'fail' });
    expect(await workspace.prepare(rec('same', 'export const n: number = 1;'))).toMatchObject({
      ok: false,
      status: 'fail',
      reason: 'suggestion збігається з поточним кодом і нічого не змінює',
    });
  });

  it('fail для файлу, якого немає, і для шляху з ..', async () => {
    expect(await workspace.prepare({ ...rec('missing', 'x'), path: 'src/none.ts' })).toMatchObject({ status: 'fail' });
    expect(await workspace.prepare({ ...rec('escape', 'x'), path: '../outside.ts' })).toMatchObject({ status: 'fail' });
  });

  it('skip, якщо коміт не вдалося отримати', async () => {
    const result = await workspace.prepare({ ...rec('ghost', 'x'), commitId: 'f'.repeat(40) });
    expect(result).toMatchObject({ ok: false, status: 'skip' });
  });

  it('справжній tsc: fail для помилки типів, pass для коректної зміни', async () => {
    const graders = [suggestionApplies, createTypecheckGrader('node_modules/.bin/tsc -p . --pretty false')];
    const ctx = { repoDir, workspace };

    const broken = await evaluate(rec('broken', 'export const n: number = "text";'), graders, ctx);
    expect(broken.results.map((r) => r.status)).toEqual(['pass', 'fail']);
    expect(broken.results[1]?.evidence).toContain('TS2322 у src/a.ts:1');

    const fine = await evaluate(rec('fine', 'export const n: number = 42;'), graders, ctx);
    expect(fine.results.map((r) => r.status)).toEqual(['pass', 'pass']);
  }, 60_000);

  it('dispose прибирає всі worktree', async () => {
    const extra = new GitWorkspace({ repoDir, tempDir: join(root, 'extra'), timeoutMs: 10_000 });
    await extra.prepare(rec('tmp', 'export const n: number = 5;'));
    expect(git('worktree', 'list').split('\n').length).toBeGreaterThan(1);

    await extra.dispose();
    expect(existsSync(join(root, 'extra'))).toBe(false);
    expect(git('worktree', 'list')).not.toContain(join(root, 'extra'));
  });
});

describe('захист node_modules', () => {
  it('зупиняє execution-перевірки, якщо команда змінила маркер встановлення', async () => {
    const guardRoot = mkdtempSync(join(tmpdir(), 'review-evals-guard-'));
    const guardRepo = join(guardRoot, 'repo');
    mkdirSync(join(guardRepo, 'node_modules'), { recursive: true });
    writeFileSync(join(guardRepo, '.gitignore'), 'node_modules\n');
    writeFileSync(join(guardRepo, 'node_modules/.modules.yaml'), 'layoutVersion: 5\n');
    writeFileSync(join(guardRepo, 'a.ts'), 'export const a = 1;\n');
    const run = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', ...args], { cwd: guardRepo });
    run('init', '-q');
    run('add', '.');
    run('commit', '-q', '-m', 'init');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: guardRepo, encoding: 'utf8' }).trim();

    const guarded = new GitWorkspace({ repoDir: guardRepo, tempDir: join(guardRoot, 'wt'), timeoutMs: 10_000 });
    try {
      const first = makeRecommendation({ id: 'g1', path: 'a.ts', startLine: 1, endLine: 1, suggestion: 'export const a = 2;', commitId: sha });
      const prepared = await guarded.prepare(first);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      const touched = await guarded.run(prepared.sandbox.after, 'sleep 0.05 && echo changed >> node_modules/.modules.yaml');
      expect(touched.exitCode).toBeNull();
      expect(touched.stderr).toContain('execution-перевірки зупинено');
      expect(guarded.dependenciesWereChanged).toBe(true);

      const second = await guarded.prepare({ ...first, id: 'g2' });
      expect(second).toMatchObject({ ok: false, status: 'skip' });
    } finally {
      await guarded.dispose();
      rmSync(guardRoot, { recursive: true, force: true });
    }
  });
});
