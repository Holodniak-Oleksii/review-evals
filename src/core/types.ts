import type { ModelClient } from './model/client';

export type RecommendationSource = 'llm' | 'human';

export type SuggestionOrigin = 'comment' | 'model';

export interface Recommendation {
  id: string;
  source: RecommendationSource;
  author: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  body: string;
  severity?: string;
  suggestion?: string;
  suggestionOrigin?: SuggestionOrigin;
  commitId?: string;
  url?: string;
}

export type GradeStatus = 'pass' | 'fail' | 'skip';

export interface GradeResult {
  grader: string;
  status: GradeStatus;
  score: number;
  evidence: string;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface Sandbox {
  before: string;
  after: string;
  files: string[];
}

export type SandboxResult =
  | { ok: true; sandbox: Sandbox }
  | { ok: false; status: 'fail' | 'skip'; reason: string };

export interface Workspace {
  checkout(commitId: string): Promise<string>;
  prepare(rec: Recommendation): Promise<SandboxResult>;
  run(dir: string, command: string): Promise<CommandResult>;
}

export interface EvalContext {
  repoDir: string;
  workspace?: Workspace;
  model?: ModelClient;
}

export type GraderKind = 'execution' | 'static' | 'model' | 'human';

export interface Grader {
  name: string;
  kind: GraderKind;
  grade(rec: Recommendation, ctx: EvalContext): Promise<GradeResult>;
}

export interface Enrichment {
  recommendation: Recommendation;
  result: GradeResult;
}

export interface Enricher {
  name: string;
  kind: GraderKind;
  enrich(rec: Recommendation, ctx: EvalContext): Promise<Enrichment>;
}

export type TrustLevel = 'high' | 'medium' | 'low';

export type AggregationMethod = 'rules' | 'logistic';

export interface TrustFactor {
  feature: string;
  contribution: number;
}

export interface TrustScore {
  score: number;
  level: TrustLevel;
  method: AggregationMethod;
  logit: number;
  factors: TrustFactor[];
  veto?: string;
}

export interface Evaluation {
  recommendation: Recommendation;
  results: GradeResult[];
  trust?: TrustScore;
}

export interface ReviewComment {
  id: number;
  node_id?: string;
  body: string;
  path: string;
  line?: number | null;
  start_line?: number | null;
  original_line?: number | null;
  original_start_line?: number | null;
  commit_id?: string;
  original_commit_id?: string;
  html_url?: string;
  in_reply_to_id?: number | null;
  user: { login: string; type: string } | null;
}
