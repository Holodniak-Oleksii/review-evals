import { spawn } from 'node:child_process';
import type { CommandResult } from '../types';

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

const KILL_GRACE_MS = 2000;

export function runCommand(command: string, options: RunOptions): Promise<CommandResult> {
  const started = Date.now();
  const limit = options.maxOutputBytes ?? 5 * 1024 * 1024;

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = new OutputBuffer(limit);
    const stderr = new OutputBuffer(limit);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    let timedOut = false;
    let settled = false;
    const killTimers: NodeJS.Timeout[] = [];
    const timer = setTimeout(() => {
      timedOut = true;
      kill(child.pid, 'SIGTERM');
      killTimers.push(
        setTimeout(() => kill(child.pid, 'SIGKILL'), KILL_GRACE_MS),
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, KILL_GRACE_MS * 2),
      );
    }, options.timeoutMs);

    const finish = (exitCode: number | null, extraError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTimers.forEach(clearTimeout);
      if (extraError) stderr.push(Buffer.from(extraError));
      resolve({
        command,
        exitCode: timedOut ? null : exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));
  });
}

function kill(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
}

class OutputBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.limit) {
      this.truncated = true;
      return;
    }
    const room = this.limit - this.size;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (part.length < chunk.length) this.truncated = true;
    this.chunks.push(part);
    this.size += part.length;
  }

  text(): string {
    const text = Buffer.concat(this.chunks).toString('utf8');
    return this.truncated ? `${text}\n[вивід обрізано]` : text;
  }
}
