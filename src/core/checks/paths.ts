import { realpathSync } from 'node:fs';
import { relative } from 'node:path';

export function rootDirs(dir: string): string[] {
  try {
    return [dir, realpathSync(dir)];
  } catch {
    return [dir];
  }
}

export function relativeTo(dirs: readonly string[], filePath: string): string {
  const candidates = dirs.map((dir) => relative(dir, filePath).replace(/\\/g, '/'));
  return candidates.find((path) => !path.startsWith('..')) ?? candidates[0] ?? filePath;
}
