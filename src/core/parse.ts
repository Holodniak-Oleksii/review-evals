import type { Recommendation, ReviewComment } from './types';

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*suggestion(?:[ \t].*)?$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export function extractSuggestion(body: string): string | undefined {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const opening = OPENING_FENCE.exec(lines[i] ?? '');
    if (!opening) continue;

    const indent = opening[1]?.length ?? 0;
    const fence = opening[2] ?? '```';
    const content: string[] = [];

    for (const line of lines.slice(i + 1)) {
      if (isClosingFence(line, fence)) return content.join('\n');
      content.push(removeIndent(line, indent));
    }

    if (content.at(-1) === '') content.pop();
    return content.join('\n');
  }

  return undefined;
}

export function parseRecommendation(comment: ReviewComment): Recommendation {
  const outdated = comment.line == null;
  const endLine = (outdated ? comment.original_line : comment.line) ?? null;
  const startLine = (outdated ? comment.original_start_line : comment.start_line) ?? endLine;
  const commitId = outdated ? comment.original_commit_id : comment.commit_id;

  const rec: Recommendation = {
    id: String(comment.id),
    source: comment.user?.type === 'Bot' ? 'llm' : 'human',
    author: comment.user?.login ?? 'ghost',
    path: comment.path,
    startLine,
    endLine,
    body: comment.body,
  };

  const severity = extractSeverity(comment.body);
  if (severity) rec.severity = severity;
  const suggestion = extractSuggestion(comment.body);
  if (suggestion !== undefined) {
    rec.suggestion = suggestion;
    rec.suggestionOrigin = 'comment';
  }
  if (commitId) rec.commitId = commitId;
  if (comment.html_url) rec.url = comment.html_url;

  return rec;
}

export function extractSeverity(body: string): string | undefined {
  return /^\s*(?:\*\*)?\[([A-Za-z][\w-]{0,19})\]/.exec(body)?.[1]?.toLowerCase();
}

function isClosingFence(line: string, opening: string): boolean {
  const fence = CLOSING_FENCE.exec(line)?.[1];
  return fence !== undefined && fence[0] === opening[0] && fence.length >= opening.length;
}

function removeIndent(line: string, indent: number): string {
  let i = 0;
  while (i < indent && line[i] === ' ') i++;
  return line.slice(i);
}
