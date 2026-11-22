import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  createDefaultGraders,
  detectCommands,
  errorMessage,
  evaluate,
  formatLocation,
  parseRecommendation,
  renderReply,
  renderSummary,
  resolveCommands,
  selectPendingComments,
  type Evaluation,
} from '../core';
import { readInputs } from './inputs';
import { isForkPullRequest, resolvePullRequestNumber } from './pull-request';
import { createWorkspace } from './workspace';

const STATUS_ICON = { pass: '✔', fail: '✘', skip: '–' } as const;

async function run(): Promise<void> {
  const inputs = readInputs();
  if (inputs.mode !== 'annotate') {
    core.warning(`Режим "${inputs.mode}" ще не реалізовано (етап 4). Працюю в режимі annotate.`);
  }

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
  const octokit = github.getOctokit(inputs.token);

  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  const { pending, alreadyEvaluated } = selectPendingComments(comments);
  core.info(
    `PR #${pullNumber}: коментарів ${comments.length}, нових для оцінювання ${pending.length}, ` +
      `вже оцінено ${alreadyEvaluated.length}.`,
  );

  const repoDir = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const commands = resolveCommands(detectCommands(repoDir), inputs.commands);
  core.info(`Команди: typecheck=${commands.typecheck}, lint=${commands.lint}, tests=${commands.test}`);

  const graders = createDefaultGraders(commands);
  const { workspace, dispose } = createWorkspace({
    repoDir,
    token: inputs.token,
    serverUrl: context.serverUrl,
    runId: context.runId,
    timeoutMs: inputs.timeoutMs,
    fork: isForkPullRequest(context.payload),
    allowForks: inputs.allowForks,
  });

  const evaluations: Evaluation[] = [];
  const failures: string[] = [];

  try {
    for (const comment of pending) {
      const rec = parseRecommendation(comment);
      await core.group(`Коментар ${comment.id} (${formatLocation(rec)})`, async () => {
        try {
          const evaluation = await evaluate(rec, graders, { repoDir, workspace });
          for (const r of evaluation.results) core.info(`${STATUS_ICON[r.status]} ${r.grader}: ${r.evidence}`);
          await octokit.rest.pulls.createReplyForReviewComment({
            owner,
            repo,
            pull_number: pullNumber,
            comment_id: comment.id,
            body: renderReply(evaluation),
          });
          evaluations.push(evaluation);
          core.info('Відповідь опубліковано.');
        } catch (error) {
          const message = `Коментар ${comment.id}: ${errorMessage(error)}`;
          failures.push(message);
          core.error(message);
        }
      });
    }
  } finally {
    await dispose().catch((error: unknown) => core.warning(`Не вдалося прибрати робочі теки: ${errorMessage(error)}`));
  }

  await core.summary
    .addRaw(
      renderSummary({
        pullNumber,
        mode: inputs.mode,
        evaluations,
        alreadyEvaluated: alreadyEvaluated.length,
        failed: failures.length,
        commands,
      }),
      true,
    )
    .write();

  if (failures.length > 0) {
    core.setFailed(`Не вдалося обробити коментарів: ${failures.length}. ${failures.join('; ')}`);
  }
}

run().catch((error: unknown) => {
  core.setFailed(`Review Evals: ${errorMessage(error)}`);
});
