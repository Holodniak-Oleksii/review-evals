import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  defaultGraders,
  errorMessage,
  evaluate,
  parseMode,
  parseRecommendation,
  renderReply,
  renderSummary,
  selectPendingComments,
  type Evaluation,
} from '../core';
import { resolvePullRequestNumber } from './pull-request';

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const mode = parseMode(core.getInput('mode'));
  if (mode !== 'annotate') {
    core.warning(`Режим "${mode}" ще не реалізовано (етап 4). Працюю в режимі annotate.`);
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
  const octokit = github.getOctokit(token);

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

  const ctx = { repoDir: process.env.GITHUB_WORKSPACE ?? process.cwd() };
  const evaluations: Evaluation[] = [];
  const failures: string[] = [];

  for (const comment of pending) {
    try {
      const evaluation = await evaluate(parseRecommendation(comment), defaultGraders, ctx);
      await octokit.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        comment_id: comment.id,
        body: renderReply(evaluation),
      });
      evaluations.push(evaluation);
      core.info(`Коментар ${comment.id}: відповідь опубліковано.`);
    } catch (error) {
      const message = `Коментар ${comment.id}: ${errorMessage(error)}`;
      failures.push(message);
      core.error(message);
    }
  }

  await core.summary
    .addRaw(
      renderSummary({
        pullNumber,
        mode,
        evaluations,
        alreadyEvaluated: alreadyEvaluated.length,
        failed: failures.length,
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
