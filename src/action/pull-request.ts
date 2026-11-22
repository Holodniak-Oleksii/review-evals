export interface PullRequestPayload {
  pull_request?: { number: number } | null;
  workflow_run?: { pull_requests?: ReadonlyArray<{ number: number }> | null } | null;
}

export function resolvePullRequestNumber(payload: PullRequestPayload): number | undefined {
  return payload.pull_request?.number ?? payload.workflow_run?.pull_requests?.[0]?.number;
}
