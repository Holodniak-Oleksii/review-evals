import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExecutionCommands {
  typecheck: string | null;
  lint: string | null;
  test: string | null;
}

export type CommandOverrides = Partial<Record<keyof ExecutionCommands, string | undefined>>;

type PackageManager = 'pnpm' | 'yarn' | 'npm';

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const DISABLED = new Set(['off', 'false', 'none', 'disabled']);
const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types', 'tsc'];

export function detectCommands(repoDir: string): ExecutionCommands {
  const pkg = readPackageJson(repoDir);
  if (!pkg) return { typecheck: null, lint: null, test: null };

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const pm = detectPackageManager(repoDir, pkg);
  const exec = { pnpm: 'pnpm exec', yarn: 'yarn run', npm: 'npm exec --no --' }[pm];
  const run = (script: string) => (pm === 'npm' ? `npm run --silent ${script}` : `${pm} run ${script}`);

  const typecheckScript = TYPECHECK_SCRIPTS.find((name) => pkg.scripts?.[name]);
  const typecheck = typecheckScript ? run(typecheckScript) : deps.typescript ? `${exec} tsc --noEmit` : null;
  const lint = deps.eslint ? `${exec} eslint` : null;
  const test = deps.vitest
    ? `${exec} vitest related --run --passWithNoTests --reporter=json --outputFile={report} {files}`
    : deps.jest
      ? `${exec} jest --findRelatedTests --passWithNoTests --json --outputFile={report} {files}`
      : null;

  return { typecheck, lint, test };
}

export function resolveCommands(detected: ExecutionCommands, overrides: CommandOverrides): ExecutionCommands {
  const pick = (key: keyof ExecutionCommands): string | null => {
    const value = overrides[key]?.trim();
    if (!value) return detected[key];
    return DISABLED.has(value.toLowerCase()) ? null : value;
  };
  return { typecheck: pick('typecheck'), lint: pick('lint'), test: pick('test') };
}

function detectPackageManager(repoDir: string, pkg: PackageJson): PackageManager {
  const declared = pkg.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'npm') return declared;
  if (existsSync(join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function readPackageJson(repoDir: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}
