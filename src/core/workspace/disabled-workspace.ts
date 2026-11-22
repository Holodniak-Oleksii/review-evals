import type { CommandResult, SandboxResult, Workspace } from '../types';

export class DisabledWorkspace implements Workspace {
  constructor(private readonly reason: string) {}

  async prepare(): Promise<SandboxResult> {
    return { ok: false, status: 'skip', reason: this.reason };
  }

  async run(_dir: string, command: string): Promise<CommandResult> {
    return { command, exitCode: null, stdout: '', stderr: this.reason, timedOut: false, durationMs: 0 };
  }
}
