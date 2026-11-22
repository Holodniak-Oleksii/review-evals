import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  AnthropicModelClient,
  createDefaultEnrichers,
  createDefaultGraders,
  decide,
  detectCommands,
  emptyState,
  errorMessage,
  evaluate,
  formatLocation,
  formatTrust,
  parseRecommendation,
  recordEvaluation,
  renderReply,
  renderSummary,
  resolveCommands,
  selectPendingComments,
  type SummaryEntry,
} from '../core';
import { loadAggregator } from './aggregator';
import { loadState, minimizeComment, saveState, type StoredState } from './github';
import { readInputs } from './inputs';
import { isForkPullRequest, resolvePullRequestNumber } from './pull-request';
import { createWorkspace } from './workspace';

const STATUS_ICON = { pass: '✔', fail: '✘', skip: '–' } as const;

async function run(): Promise<void> {
  const inputs = readInputs();
  const { context } = github;
  const pullNumber = resolvePullRequestNumber(context.payload);
  if (pullNumber === undefined) {
    core.warning(
      `Подія "${context.eventName}" не містить pull request ` +
        '(або PR створено з форку). Нічого оцінювати.',
    );
    return;
  }

  const { owner, repo } = context.repo;
  const ref = { owner, repo, pullNumber };
  const octokit = github.getOctokit(inputs.token);
  const repoDir = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const aggregator = loadAggregator(inputs.aggregator, inputs.weightsFile, {
    workspace: repoDir,
    ...(process.env.GITHUB_ACTION_PATH ? { actionPath: process.env.GITHUB_ACTION_PATH } : {}),
  });
  const stored: StoredState = inputs.mode === 'filter' ? await loadState(octokit, ref) : { state: emptyState() };

  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  const { pending, alreadyEvaluated } = selectPendingComments(comments, Object.keys(stored.state.evaluated));
  core.info(
    `PR #${pullNumber}: коментарів ${comments.length}, нових для оцінювання ${pending.length}, ` +
      `вже оцінено ${alreadyEvaluated.length}. Режим: ${inputs.mode}. Агрегація: ${aggregator.label}.`,
  );

  const commands = resolveCommands(detectCommands(repoDir), inputs.commands);
  core.info(`Команди: typecheck=${commands.typecheck}, lint=${commands.lint}, tests=${commands.test}`);

  const graders = createDefaultGraders(commands);
  const enrichers = createDefaultEnrichers();
  const model = inputs.anthropicApiKey ? new AnthropicModelClient(inputs.anthropicApiKey, inputs.model) : undefined;
  core.info(model ? `LLM-оцінювачі: ${model.model}` : 'LLM-оцінювачі вимкнено: немає anthropic-api-key.');
  const { workspace, dispose, dependenciesChanged } = createWorkspace({
    repoDir,
    token: inputs.token,
    serverUrl: context.serverUrl,
    runId: context.runId,
    timeoutMs: inputs.timeoutMs,
    fork: isForkPullRequest(context.payload),
    allowForks: inputs.allowForks,
  });

  const entries: SummaryEntry[] = [];
  const failures: string[] = [];
  const decisionOptions = { minTrust: inputs.minTrust, minimizeSources: inputs.minimizeSources };

  try {
    for (const comment of pending) {
      const rec = parseRecommendation(comment);
      await core.group(`Коментар ${comment.id} (${formatLocation(rec)})`, async () => {
        try {
          const evaluation = await evaluate(rec, graders, { repoDir, workspace, model }, enrichers);
          evaluation.trust = aggregator.aggregate(evaluation);
          for (const r of evaluation.results) core.info(`${STATUS_ICON[r.status]} ${r.grader}: ${r.evidence}`);
          core.info(`Довіра: ${formatTrust(evaluation.trust)}`);

          const decision = decide(inputs.mode, evaluation.recommendation, evaluation.trust, decisionOptions);
          let minimized = false;
          if (decision.minimize) {
            try {
              await minimizeComment(octokit, comment.node_id);
              minimized = true;
              core.info('Коментар згорнуто.');
            } catch (error) {
              const message = `Коментар ${comment.id}: не вдалося згорнути: ${errorMessage(error)}`;
              failures.push(message);
              core.error(message);
            }
          }
          if (decision.reply) {
            await octokit.rest.pulls.createReplyForReviewComment({
              owner,
              repo,
              pull_number: pullNumber,
              comment_id: comment.id,
              body: renderReply(evaluation, { minimized, minTrust: inputs.minTrust }),
            });
            core.info('Відповідь опубліковано.');
          }
          recordEvaluation(stored.state, String(comment.id), evaluation, minimized);
          entries.push({ ...evaluation, minimized });
        } catch (error) {
          const message = `Коментар ${comment.id}: ${errorMessage(error)}`;
          failures.push(message);
          core.error(message);
        }
      });
    }
  } finally {
    if (dependenciesChanged()) {
      core.warning(
        'Одна з команд змінила node_modules (менеджер пакетів перевстановив залежності). ' +
          'Execution-перевірки після цього пропущено.',
      );
    }
    await dispose().catch((error: unknown) => core.warning(`Не вдалося прибрати робочі теки: ${errorMessage(error)}`));
  }

  if (inputs.mode === 'filter' && entries.length > 0) {
    await saveState(octokit, ref, stored, inputs.minTrust).catch((error: unknown) => {
      const message = `Не вдалося зберегти стан у коментарі PR: ${errorMessage(error)}`;
      failures.push(message);
      core.error(message);
    });
  }

  await core.summary
    .addRaw(
      renderSummary({
        pullNumber,
        mode: inputs.mode,
        evaluations: entries,
        alreadyEvaluated: alreadyEvaluated.length,
        failed: failures.length,
        commands,
        aggregation: aggregator.label,
      }),
      true,
    )
    .write();

  if (failures.length > 0) {
    core.setFailed(`Не вдалося обробити: ${failures.length}. ${failures.join('; ')}`);
  }
}

run().catch((error: unknown) => {
  core.setFailed(`Review Evals: ${errorMessage(error)}`);
});
