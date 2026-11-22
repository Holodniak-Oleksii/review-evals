import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { DisabledWorkspace, GitWorkspace, type Workspace } from '../core';

export interface WorkspaceSettings {
  repoDir: string;
  token: string;
  serverUrl: string;
  runId: number;
  timeoutMs: number;
  fork: boolean;
  allowForks: boolean;
}

export interface ActionWorkspace {
  workspace: Workspace;
  dispose(): Promise<void>;
  dependenciesChanged(): boolean;
}

export function createWorkspace(settings: WorkspaceSettings): ActionWorkspace {
  if (settings.fork && !settings.allowForks) {
    return disabled('виконання коду з PR із форку вимкнено (allow-forks: false)');
  }
  if (!existsSync(join(settings.repoDir, '.git'))) {
    return disabled('репозиторій не завантажено, додайте крок actions/checkout');
  }

  const workspace = new GitWorkspace({
    repoDir: settings.repoDir,
    tempDir: join(process.env.RUNNER_TEMP ?? tmpdir(), `review-evals-${settings.runId}-${Date.now()}`),
    timeoutMs: settings.timeoutMs,
    fetchEnv: authEnv(settings.token, settings.serverUrl),
  });
  return {
    workspace,
    dispose: () => workspace.dispose(),
    dependenciesChanged: () => workspace.dependenciesWereChanged,
  };
}

function disabled(reason: string): ActionWorkspace {
  return { workspace: new DisabledWorkspace(reason), dispose: async () => undefined, dependenciesChanged: () => false };
}

function authEnv(token: string, serverUrl: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  core.setSecret(basic);
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${serverUrl}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}
