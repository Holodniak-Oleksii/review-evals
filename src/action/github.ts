import type * as github from '@actions/github';
import { isStateComment, parseState, renderState, type PullRequestState } from '../core';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

const MINIMIZE = `
  mutation ($id: ID!) {
    minimizeComment(input: { subjectId: $id, classifier: OFF_TOPIC }) {
      minimizedComment { isMinimized }
    }
  }
`;

export async function minimizeComment(octokit: Octokit, nodeId: string | undefined): Promise<void> {
  if (!nodeId) throw new Error('немає node_id коментаря для GraphQL');
  await octokit.graphql(MINIMIZE, { id: nodeId });
}

export interface StoredState {
  state: PullRequestState;
  commentId?: number;
}

export async function loadState(octokit: Octokit, ref: PullRequestRef): Promise<StoredState> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.pullNumber,
    per_page: 100,
  });
  const stored = comments.find((comment) => isStateComment(comment.body));
  return { state: parseState(stored?.body), ...(stored ? { commentId: stored.id } : {}) };
}

export async function saveState(octokit: Octokit, ref: PullRequestRef, stored: StoredState, minTrust: number): Promise<void> {
  const body = renderState(stored.state, minTrust);
  if (stored.commentId !== undefined) {
    await octokit.rest.issues.updateComment({ owner: ref.owner, repo: ref.repo, comment_id: stored.commentId, body });
  } else {
    await octokit.rest.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.pullNumber, body });
  }
}
