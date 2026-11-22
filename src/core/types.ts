export type RecommendationSource = 'llm' | 'human';

export interface Recommendation {
  id: string;
  source: RecommendationSource;
  author: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  body: string;
  suggestion?: string;
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
  prepare(rec: Recommendation): Promise<SandboxResult>;
  run(dir: string, command: string): Promise<CommandResult>;
}

export interface EvalContext {
  repoDir: string;
  workspace?: Workspace;
}

export type GraderKind = 'execution' | 'static' | 'model' | 'human';

export interface Grader {
  name: string;
  kind: GraderKind;
  grade(rec: Recommendation, ctx: EvalContext): Promise<GradeResult>;
}

export interface Evaluation {
  recommendation: Recommendation;
  results: GradeResult[];
}

export interface ReviewComment {
  id: number;
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
