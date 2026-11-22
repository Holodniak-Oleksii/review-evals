import { existsSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type * as TS from 'typescript';

export type Lookup = 'found' | 'unknown' | 'missing' | 'unseen';

export type ProjectLoad = { ok: true; project: TypeScriptProject } | { ok: false; reason: string };

const TYPESCRIPT_MODULE = 'typescript';
const WORD = /[A-Za-z_$][\w$]*/g;

export class TypeScriptProject {
  private nameCache: Set<string> | undefined;

  private constructor(
    private readonly ts: typeof TS,
    private readonly program: TS.Program,
    private readonly options: TS.CompilerOptions,
    readonly dir: string,
  ) {}

  static load(dir: string): ProjectLoad {
    let ts: typeof TS;
    try {
      const load = createRequire(join(dir, 'package.json'));
      ts = load(TYPESCRIPT_MODULE) as typeof TS;
    } catch {
      return { ok: false, reason: 'у проєкті немає пакета typescript' };
    }
    if (typeof ts.createProgram !== 'function') {
      return { ok: false, reason: `TypeScript ${ts.version ?? ''} не має JS API` };
    }

    const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) return { ok: false, reason: 'у проєкті немає tsconfig.json' };

    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    });
    if (!parsed) return { ok: false, reason: 'не вдалося прочитати tsconfig.json' };

    const options = { ...parsed.options, noEmit: true };
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options,
      ...(parsed.projectReferences ? { projectReferences: parsed.projectReferences } : {}),
    });
    return { ok: true, project: new TypeScriptProject(ts, program, options, dir) };
  }

  hasFile(path: string, fromFile: string): boolean {
    return [join(this.dir, path), join(this.dir, dirname(fromFile), path)].some((candidate) => existsSync(candidate));
  }

  hasModule(specifier: string, fromFile: string): boolean {
    if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return true;
    const containing = join(this.dir, fromFile);
    const resolved = this.ts.resolveModuleName(specifier, containing, this.options, this.ts.sys);
    return resolved.resolvedModule !== undefined;
  }

  lookup(path: string[], fromFile: string, line: number | null): Lookup {
    const [head, ...rest] = path;
    if (!head) return 'unknown';

    const sourceFile = this.program.getSourceFile(join(this.dir, fromFile));
    const symbol = sourceFile ? this.symbolInScope(sourceFile, line, head) : undefined;
    if (!symbol) {
      const known = (name: string) => name === 'prototype' || this.names().has(name);
      if (rest.length === 0) return known(head) || this.hasModule(head, fromFile) ? 'found' : 'unseen';
      return path.every(known) ? 'found' : 'unseen';
    }
    if (rest.length === 0) return 'found';
    return this.lookupMembers(symbol, rest, sourceFile!);
  }

  private lookupMembers(start: TS.Symbol, members: string[], location: TS.Node): Lookup {
    const { ts } = this;
    const checker = this.program.getTypeChecker();
    let symbol = start.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(start) : start;
    let type: TS.Type | undefined;

    for (const member of members) {
      if (member === 'prototype') {
        type = checker.getDeclaredTypeOfSymbol(symbol);
        continue;
      }

      const exported = symbol.exports?.get(member as TS.__String);
      if (!type && exported) {
        symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        continue;
      }

      const current = type ?? valueOrDeclaredType(checker, ts, symbol, location);
      if (current.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return 'unknown';

      const property = findProperty(checker, current, member);
      if (!property) return 'missing';
      symbol = property;
      type = undefined;
    }
    return 'found';
  }

  private symbolInScope(sourceFile: TS.SourceFile, line: number | null, name: string): TS.Symbol | undefined {
    const { ts } = this;
    const checker = this.program.getTypeChecker();
    const node = nodeAtLine(ts, sourceFile, line);
    const flags = ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias;
    return checker.getSymbolsInScope(node, flags).find((symbol) => symbol.name === name);
  }

  private names(): Set<string> {
    if (this.nameCache) return this.nameCache;
    const { ts } = this;
    const names = new Set<string>();
    const stringTokens = new Set([
      ts.SyntaxKind.StringLiteral,
      ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ts.SyntaxKind.TemplateHead,
      ts.SyntaxKind.TemplateMiddle,
      ts.SyntaxKind.TemplateTail,
    ]);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
    for (const file of this.program.getSourceFiles()) {
      scanner.setLanguageVariant(file.languageVariant);
      scanner.setText(file.text);
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.PrivateIdentifier) {
          names.add(scanner.getTokenText().replace(/^#/, ''));
        } else if (stringTokens.has(token)) {
          for (const word of scanner.getTokenValue().match(WORD) ?? []) names.add(word);
        }
      }
    }
    this.nameCache = names;
    return names;
  }
}

function valueOrDeclaredType(checker: TS.TypeChecker, ts: typeof TS, symbol: TS.Symbol, location: TS.Node): TS.Type {
  if (symbol.flags & ts.SymbolFlags.Value) return checker.getTypeOfSymbolAtLocation(symbol, location);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

function findProperty(checker: TS.TypeChecker, type: TS.Type, name: string): TS.Symbol | undefined {
  const parts = type.isUnion() ? type.types : [type];
  for (const part of parts) {
    const property = checker.getPropertyOfType(checker.getApparentType(part), name);
    if (property) return property;
  }
  return undefined;
}

function nodeAtLine(ts: typeof TS, sourceFile: TS.SourceFile, line: number | null): TS.Node {
  if (line === null) return sourceFile;
  const lastLine = sourceFile.getLineStarts().length;
  const position = sourceFile.getPositionOfLineAndCharacter(Math.min(Math.max(line, 1), lastLine) - 1, 0);

  let node: TS.Node = sourceFile;
  for (;;) {
    const child: TS.Node | undefined = ts.forEachChild(node, (candidate) =>
      candidate.pos <= position && position < candidate.end ? candidate : undefined,
    );
    if (!child) return node;
    node = child;
  }
}
