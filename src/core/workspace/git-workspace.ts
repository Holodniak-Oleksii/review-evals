import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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

const INSTALL_MARKERS = ['.modules.yaml', '.package-lock.json', '.yarn-state.yml'];
const DEPENDENCIES_CHANGED =
  'команда змінила залежності в node_modules основного checkout, тому execution-перевірки зупинено';

export class GitWorkspace implements Workspace {
  private readonly baselines = new Map<string, Promise<string>>();
  private readonly sandboxes = new Map<string, Promise<SandboxResult>>();
  private readonly runs = new Map<string, Promise<CommandResult>>();
  private readonly worktrees: string[] = [];
  private readonly env: NodeJS.ProcessEnv;
  private readonly markers: Map<string, number>;
  private dependenciesChanged = false;

  constructor(private readonly options: GitWorkspaceOptions) {
    this.env = options.env ?? commandEnv();
    this.markers = snapshotMarkers(join(options.repoDir, 'node_modules'));
  }

  checkout(commitId: string): Promise<string> {
    return this.baseline(commitId);
  }

  prepare(rec: Recommendation): Promise<SandboxResult> {
    if (this.dependenciesChanged) return Promise.resolve(skip(DEPENDENCIES_CHANGED));
    let sandbox = this.sandboxes.get(rec.id);
    if (!sandbox) {
      sandbox = this.createSandbox(rec);
      this.sandboxes.set(rec.id, sandbox);
    }
    return sandbox;
  }

  run(dir: string, command: string): Promise<CommandResult> {
    if (this.dependenciesChanged) {
      return Promise.resolve({ command, exitCode: null, stdout: '', stderr: DEPENDENCIES_CHANGED, timedOut: false, durationMs: 0 });
    }
    const key = `${dir}\0${command}`;
    let result = this.runs.get(key);
    if (!result) {
      result = runCommand(command, { cwd: dir, timeoutMs: this.options.timeoutMs, env: this.env }).then((run) =>
        this.checkDependencies(run),
      );
      this.runs.set(key, result);
    }
    return result;
  }

  get dependenciesWereChanged(): boolean {
    return this.dependenciesChanged;
  }

  private checkDependencies(run: CommandResult): CommandResult {
    const now = snapshotMarkers(join(this.options.repoDir, 'node_modules'));
    const changed = [...now].some(([path, mtime]) => this.markers.get(path) !== mtime);
    if (!changed) return run;
    this.dependenciesChanged = true;
    return { ...run, exitCode: null, stderr: `${run.stderr}\n${DEPENDENCIES_CHANGED}` };
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

function snapshotMarkers(nodeModules: string): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const marker of INSTALL_MARKERS) {
    const path = join(nodeModules, marker);
    try {
      snapshot.set(path, statSync(path).mtimeMs);
    } catch {
      snapshot.set(path, -1);
    }
  }
  return snapshot;
}

function isSafeRelativePath(path: string): boolean {
  return path !== '' && !isAbsolute(path) && !path.split(/[\\/]/).includes('..');
}
