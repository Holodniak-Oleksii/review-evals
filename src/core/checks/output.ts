import type { CommandResult } from '../types';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function combinedOutput(result: CommandResult): string {
  return stripAnsi(`${result.stdout}\n${result.stderr}`);
}

export function outputTail(result: CommandResult, maxLength = 200): string {
  const lines = combinedOutput(result)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-2).join(' ').replace(/`/g, "'");
  if (tail === '') return 'вивід порожній';
  return tail.length > maxLength ? `…${tail.slice(-maxLength)}` : tail;
}

export function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} с`;
}
