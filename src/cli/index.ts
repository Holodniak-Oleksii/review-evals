import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import * as github from '@actions/github';
import { emptyDataset, errorMessage, mergeDataset, parseDataset, type DatasetItem } from '../core';
import { collectItems } from './export';
import { prepareExamples, train } from './train';

const USAGE = `Використання:
  npm run cli -- export --repo <owner/name> --pr <номер> [--pr <номер> ...] --out <файл.json>
  npm run cli -- train --dataset <файл.json> --out <weights.json> [--l2 <число>]

Токен GitHub береться з GITHUB_TOKEN, GH_TOKEN або з "gh auth token".`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'export') return exportCommand(rest);
  if (command === 'train') return trainCommand(rest);
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

async function trainCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { dataset: { type: 'string' }, out: { type: 'string' }, l2: { type: 'string', default: '1' } },
  });
  const l2 = Number(values.l2);
  if (!values.dataset || !values.out || !Number.isFinite(l2) || l2 < 0) throw new Error(USAGE);

  const dataset = parseDataset(await readFile(values.dataset, 'utf8'));
  const { skipped } = prepareExamples(dataset);
  const result = train(dataset, basename(values.dataset), l2);

  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(result.weights, null, 2)}\n`, 'utf8');

  console.log(
    `Навчено на ${result.weights.items} прикладах (пропущено: без мітки ${skipped.unlabeled}, ` +
      `unclear ${skipped.unclear}, без результатів ${skipped.withoutResults}).`,
  );
  console.log(`На навчальних даних: accuracy ${result.accuracy.toFixed(3)}, log loss ${result.logLoss.toFixed(3)}.`);
  console.log('Це оцінка на тих самих даних, тобто завищена. Чесні метрики — етап 5.');
  const top = Object.entries(result.weights.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
  for (const [feature, weight] of top) console.log(`  ${weight >= 0 ? '+' : ''}${weight.toFixed(3)}  ${feature}`);
  console.log(`Ваги записано у ${values.out}.`);
}

async function exportCommand(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      repo: { type: 'string' },
      pr: { type: 'string', multiple: true },
      out: { type: 'string' },
    },
  });
  const repo = values.repo;
  const pulls = (values.pr ?? []).map(Number);
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || pulls.length === 0 || pulls.some((n) => !Number.isInteger(n) || n <= 0) || !values.out) {
    throw new Error(USAGE);
  }
  const [owner, name] = repo.split('/') as [string, string];

  const octokit = github.getOctokit(githubToken());
  const items: DatasetItem[] = [];
  for (const pullNumber of pulls) {
    const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner,
      repo: name,
      pull_number: pullNumber,
      per_page: 100,
    });
    const collected = collectItems(repo, pullNumber, comments);
    const evaluated = collected.filter((item) => item.results !== null).length;
    console.log(`PR #${pullNumber}: рекомендацій ${collected.length}, з результатами Review Evals ${evaluated}.`);
    items.push(...collected);
  }

  const existing = existsSync(values.out) ? parseDataset(await readFile(values.out, 'utf8')) : emptyDataset();
  const { dataset, added, updated } = mergeDataset(existing, items);
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  const labeled = dataset.items.filter((item) => item.label !== null).length;
  console.log(`${values.out}: нових ${added}, оновлено ${updated}, усього ${dataset.items.length}, розмічено ${labeled}.`);
}

function githubToken(): string {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Немає токена GitHub: задайте GITHUB_TOKEN або увійдіть через "gh auth login".');
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
