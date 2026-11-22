export interface PullRequestPayload {
  repository?: { full_name?: string } | null;
  pull_request?: { number: number; head?: { repo?: { full_name?: string } | null } | null } | null;
  workflow_run?: {
    pull_requests?: ReadonlyArray<{ number: number }> | null;
    head_repository?: { full_name?: string } | null;
  } | null;
}

export function resolvePullRequestNumber(payload: PullRequestPayload): number | undefined {
  return payload.pull_request?.number ?? payload.workflow_run?.pull_requests?.[0]?.number;
}

export function isForkPullRequest(payload: PullRequestPayload): boolean {
  const base = payload.repository?.full_name;
  const head = payload.pull_request?.head?.repo?.full_name ?? payload.workflow_run?.head_repository?.full_name;
  return Boolean(base && head && base !== head);
}
