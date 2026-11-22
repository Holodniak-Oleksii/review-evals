export function applySuggestion(
  content: string,
  startLine: number,
  endLine: number,
  suggestion: string,
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalEol = content.endsWith(eol);
  const body = hasFinalEol ? content.slice(0, -eol.length) : content;
  const lines = body === '' ? [] : body.split(eol);

  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error(`некоректний діапазон рядків ${startLine}-${endLine}`);
  }
  if (endLine > lines.length) {
    throw new Error(`рядки ${startLine}-${endLine} виходять за межі файлу (${lines.length} рядків)`);
  }

  const replacement = suggestion === '' ? [] : suggestion.split('\n');
  const updated = [...lines.slice(0, startLine - 1), ...replacement, ...lines.slice(endLine)];
  const joined = updated.join(eol);
  return hasFinalEol && updated.length > 0 ? joined + eol : joined;
}
