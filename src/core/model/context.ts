import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalContext, Recommendation } from '../types';

const CONTEXT_LINES = 20;

export interface CodeContext {
  lines: string[];
  excerpt: string;
}

export async function loadCodeContext(rec: Recommendation, ctx: EvalContext): Promise<CodeContext | undefined> {
  if (!ctx.workspace || !rec.commitId) return undefined;
  try {
    const dir = await ctx.workspace.checkout(rec.commitId);
    const content = await readFile(join(dir, rec.path), 'utf8');
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    return { lines, excerpt: excerpt(lines, rec.startLine ?? rec.endLine, rec.endLine) };
  } catch {
    return undefined;
  }
}

export function excerpt(lines: string[], start: number | null, end: number | null): string {
  if (start === null || end === null) {
    return lines.slice(0, CONTEXT_LINES * 2).map((line, i) => `${i + 1}  ${line}`).join('\n');
  }
  const from = Math.max(1, start - CONTEXT_LINES);
  const to = Math.min(lines.length, end + CONTEXT_LINES);
  const width = String(to).length;
  const shown: string[] = [];
  for (let n = from; n <= to; n++) {
    const marker = n >= start && n <= end ? '>' : ' ';
    shown.push(`${marker} ${String(n).padStart(width)}  ${lines[n - 1] ?? ''}`);
  }
  return shown.join('\n');
}

export function describeRecommendation(rec: Recommendation, context: CodeContext | undefined): string {
  const range = rec.endLine === null ? 'весь файл' : `рядки ${rec.startLine ?? rec.endLine}-${rec.endLine}`;
  const code = context
    ? `<file path="${rec.path}" commented="${range}">\n${context.excerpt}\n</file>`
    : `<file path="${rec.path}" commented="${range}">код недоступний</file>`;
  return `${code}\n\n<comment author="${rec.author}" source="${rec.source}">\n${rec.body}\n</comment>`;
}
