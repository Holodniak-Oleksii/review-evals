import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { commandEnv, runCommand } from '../src/core';

const node = JSON.stringify(process.execPath);

describe('runCommand', () => {
  it('повертає код виходу і вивід', async () => {
    const result = await runCommand(`${node} -e "console.log('out'); console.error('err'); process.exit(3)"`, {
      cwd: tmpdir(),
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
    expect(result.timedOut).toBe(false);
  });

  it('зупиняє команду після таймауту разом із дочірніми процесами', async () => {
    const started = Date.now();
    const result = await runCommand(`${node} -e "setTimeout(() => {}, 60000)" & wait`, {
      cwd: tmpdir(),
      timeoutMs: 300,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('обрізає задовгий вивід', async () => {
    const result = await runCommand(`${node} -e "process.stdout.write('x'.repeat(5000))"`, {
      cwd: tmpdir(),
      timeoutMs: 10_000,
      maxOutputBytes: 100,
    });

    expect(result.stdout.startsWith('x'.repeat(100))).toBe(true);
    expect(result.stdout).toContain('[вивід обрізано]');
  });
});

describe('commandEnv', () => {
  it('прибирає токени й вмикає CI', () => {
    const env = commandEnv({
      PATH: '/bin',
      'INPUT_GITHUB-TOKEN': 'secret',
      GITHUB_TOKEN: 'secret',
      ACTIONS_RUNTIME_TOKEN: 'secret',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret',
      GITHUB_WORKSPACE: '/work',
    });

    expect(env).toEqual({ PATH: '/bin', GITHUB_WORKSPACE: '/work', CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' });
  });
});
