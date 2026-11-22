import { hasMarker } from './marker';
import type { ReviewComment } from './types';

export interface CommentSelection<T> {
  pending: T[];
  alreadyEvaluated: T[];
}

export function selectPendingComments<T extends ReviewComment>(
  comments: readonly T[],
  evaluatedIds: Iterable<string> = [],
): CommentSelection<T> {
  const answered = new Set<number>();
  for (const comment of comments) {
    if (comment.in_reply_to_id != null && hasMarker(comment.body)) {
      answered.add(comment.in_reply_to_id);
    }
  }
  for (const id of evaluatedIds) answered.add(Number(id));

  const roots = comments.filter((comment) => comment.in_reply_to_id == null && !hasMarker(comment.body));
  return {
    pending: roots.filter((comment) => !answered.has(comment.id)),
    alreadyEvaluated: roots.filter((comment) => answered.has(comment.id)),
  };
}
