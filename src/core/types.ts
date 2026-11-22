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

export interface EvalContext {
  repoDir: string;
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
