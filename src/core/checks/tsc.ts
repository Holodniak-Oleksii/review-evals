export interface TscDiagnostic {
  file: string;
  line: number;
  code: string;
  message: string;
}

const PLAIN = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;
const PRETTY = /^(.+?):(\d+):\d+ - error (TS\d+): (.*)$/;
const GLOBAL = /^error (TS\d+): (.*)$/;

export function parseTscOutput(output: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const match = PLAIN.exec(line) ?? PRETTY.exec(line);
    if (match) {
      diagnostics.push({
        file: normalizePath(match[1] ?? ''),
        line: Number(match[2]),
        code: match[3] ?? '',
        message: match[4] ?? '',
      });
      continue;
    }
    const global = GLOBAL.exec(line);
    if (global) diagnostics.push({ file: '', line: 0, code: global[1] ?? '', message: global[2] ?? '' });
  }
  return diagnostics;
}

export function tscKey(diagnostic: TscDiagnostic): string {
  return `${diagnostic.file}\0${diagnostic.code}\0${diagnostic.message}`;
}

export function formatTscDiagnostic(diagnostic: TscDiagnostic): string {
  const where = diagnostic.file ? `${diagnostic.file}:${diagnostic.line}` : 'проєкт';
  return `${diagnostic.code} у ${where}: ${diagnostic.message}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
