export type Reference =
  | { kind: 'symbol'; text: string; path: string[] }
  | { kind: 'module'; text: string; specifier: string }
  | { kind: 'file'; text: string; path: string };

const MAX_REFERENCES = 20;
const FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm;
const INLINE_CODE = /`([^`\n]+)`/g;
const IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])([^'"\n]+)\1/g;
const IDENTIFIER_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const FILE_PATH = /^(?:\.{1,2}\/)?[\w@~.-]+(?:\/[\w@.[\]-]+)+\.[A-Za-z0-9]+$/;
const JSX_TAG = /^<\/?([A-Z][\w$]*(?:\.[A-Za-z_$][\w$]*)*)[\s/>]/;
const MODULE_PATH = /^(?:@\/|\.{1,2}\/)[\w@./-]+$/;

const KEYWORDS = new Set([
  'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'keyof', 'let', 'never',
  'new', 'null', 'number', 'object', 'readonly', 'return', 'satisfies', 'static', 'string', 'super',
  'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'unknown',
  'var', 'void', 'while', 'yield', 'bigint',
]);

export function extractReferences(body: string): Reference[] {
  const text = body.replace(/\r\n?/g, '\n');
  const references = new Map<string, Reference>();
  const add = (reference: Reference) => {
    if (references.size < MAX_REFERENCES && !references.has(reference.text)) references.set(reference.text, reference);
  };

  let prose = text;
  for (const match of text.matchAll(FENCE)) {
    const info = (match[2] ?? '').trim().split(/\s+/)[0] ?? '';
    prose = prose.replace(match[0], '\n');
    if (info !== 'suggestion') for (const module of importsIn(match[3] ?? '')) add(module);
  }

  for (const match of prose.matchAll(INLINE_CODE)) {
    const span = (match[1] ?? '').trim();
    const imports = importsIn(span);
    if (imports.length > 0) {
      imports.forEach(add);
      continue;
    }
    const reference = classifySpan(span);
    if (reference) add(reference);
  }

  return [...references.values()];
}

function importsIn(code: string): Reference[] {
  return [...code.matchAll(IMPORT)].map((match) => {
    const specifier = match[2] ?? '';
    return { kind: 'module', text: specifier, specifier };
  });
}

function classifySpan(span: string): Reference | undefined {
  const jsx = JSX_TAG.exec(span);
  if (jsx?.[1]) return { kind: 'symbol', text: jsx[1], path: jsx[1].split('.') };

  if (FILE_PATH.test(span)) return { kind: 'file', text: span, path: span };
  if (MODULE_PATH.test(span)) return { kind: 'module', text: span, specifier: span };

  const symbol = span
    .replace(/\(.*\)$/s, '')
    .replace(/\?\./g, '.')
    .replace(/!/g, '')
    .replace(/^this\./, '');
  if (!IDENTIFIER_PATH.test(symbol)) return undefined;

  const path = symbol.split('.');
  if (path.length === 1 && KEYWORDS.has(path[0]!)) return undefined;
  return { kind: 'symbol', text: symbol, path };
}
