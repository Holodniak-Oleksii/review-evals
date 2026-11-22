import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { errorMessage } from '../errors';
import type { CommandResult, Recommendation, SandboxResult, Workspace } from '../types';
import { applySuggestion } from './apply';
import { commandEnv } from './env';
import { runCommand } from './exec';

const execFileAsync = promisify(execFile);

export interface GitWorkspaceOptions {
  repoDir: string;
  tempDir: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  fetchEnv?: NodeJS.ProcessEnv;
  linkNodeModules?: boolean;
}

export class GitWorkspace implements Workspace {
  private readonly baselines = new Map<string, Promise<string>>();
  private readonly sandboxes = new Map<string, Promise<SandboxResult>>();
  private readonly runs = new Map<string, Promise<CommandResult>>();
  private readonly worktrees: string[] = [];
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: GitWorkspaceOptions) {
    this.env = options.env ?? commandEnv();
  }

  prepare(rec: Recommendation): Promise<SandboxResult> {
    let sandbox = this.sandboxes.get(rec.id);
    if (!sandbox) {
      sandbox = this.createSandbox(rec);
      this.sandboxes.set(rec.id, sandbox);
    }
    return sandbox;
  }

  run(dir: string, command: string): Promise<CommandResult> {
    const key = `${dir}\0${command}`;
    let result = this.runs.get(key);
    if (!result) {
      result = runCommand(command, { cwd: dir, timeoutMs: this.options.timeoutMs, env: this.env });
      this.runs.set(key, result);
    }
    return result;
  }

  async dispose(): Promise<void> {
    for (const dir of this.worktrees.reverse()) {
      await this.git(['worktree', 'remove', '--force', dir]).catch(() => rm(dir, { recursive: true, force: true }));
    }
    await this.git(['worktree', 'prune']).catch(() => undefined);
    await rm(this.options.tempDir, { recursive: true, force: true });
  }

  private async createSandbox(rec: Recommendation): Promise<SandboxResult> {
    if (rec.suggestion === undefined) return skip('коментар не містить блоку suggestion');
    if (!rec.commitId) return skip('невідомий коміт, до якого залишено коментар');
    if (rec.endLine === null) return skip('коментар до файлу без рядків');

    if (!isSafeRelativePath(rec.path)) return fail(`некоректний шлях файлу: ${rec.path}`);

    let before: string;
    try {
      before = await this.baseline(rec.commitId);
    } catch (error) {
      return skip(`не вдалося отримати коміт ${rec.commitId.slice(0, 7)}: ${errorMessage(error)}`);
    }

    let original: string;
    try {
      original = await readFile(join(before, rec.path), 'utf8');
    } catch {
      return fail(`файлу ${rec.path} немає в коміті ${rec.commitId.slice(0, 7)}`);
    }

    let updated: string;
    try {
      updated = applySuggestion(original, rec.startLine ?? rec.endLine, rec.endLine, rec.suggestion);
    } catch (error) {
      return fail(`suggestion не застосовується: ${errorMessage(error)}`);
    }
    if (updated === original) return fail('suggestion збігається з поточним кодом і нічого не змінює');

    try {
      const after = await this.addWorktree(rec.commitId, `rec-${safeName(rec.id)}`);
      await writeFile(join(after, rec.path), updated, 'utf8');
      return { ok: true, sandbox: { before, after, files: [rec.path] } };
    } catch (error) {
      return skip(`не вдалося підготувати робочу теку: ${errorMessage(error)}`);
    }
  }

  private baseline(commit: string): Promise<string> {
    let dir = this.baselines.get(commit);
    if (!dir) {
      dir = this.ensureCommit(commit).then(() => this.addWorktree(commit, `base-${safeName(commit)}`));
      this.baselines.set(commit, dir);
    }
    return dir;
  }

  private async ensureCommit(commit: string): Promise<void> {
    const present = await this.git(['cat-file', '-e', `${commit}^{commit}`]).then(
      () => true,
      () => false,
    );
    if (present) return;

    const fetchArgs = ['fetch', '--no-tags', '--depth=1', 'origin', commit];
    try {
      await this.git(fetchArgs);
    } catch (error) {
      if (!this.options.fetchEnv) throw error;
      await this.git(fetchArgs, this.options.fetchEnv);
    }
  }

  private async addWorktree(commit: string, name: string): Promise<string> {
    const dir = join(this.options.tempDir, name);
    await mkdir(this.options.tempDir, { recursive: true });
    await this.git(['worktree', 'add', '--detach', '--force', dir, commit]);
    this.worktrees.push(dir);

    const nodeModules = join(this.options.repoDir, 'node_modules');
    if (this.options.linkNodeModules !== false && existsSync(nodeModules) && !existsSync(join(dir, 'node_modules'))) {
      await symlink(nodeModules, join(dir, 'node_modules'), 'dir');
    }
    return dir;
  }

  private async git(args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.options.repoDir,
      env: { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 16 * 1024 * 1024,
    }).catch((error: unknown) => {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new Error(stderr ? lastLine(stderr) : `git ${args[0]} завершився з помилкою`);
    });
    return stdout;
  }
}

function skip(reason: string): SandboxResult {
  return { ok: false, status: 'skip', reason };
}

function fail(reason: string): SandboxResult {
  return { ok: false, status: 'fail', reason };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).filter(Boolean).at(-1) ?? text;
}

function isSafeRelativePath(path: string): boolean {
  return path !== '' && !isAbsolute(path) && !path.split(/[\\/]/).includes('..');
}
