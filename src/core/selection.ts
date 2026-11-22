import { hasMarker } from './marker';
import type { ReviewComment } from './types';

export interface CommentSelection<T> {
  pending: T[];
  alreadyEvaluated: T[];
}

export function selectPendingComments<T extends ReviewComment>(
  comments: readonly T[],
): CommentSelection<T> {
  const answered = new Set<number>();
  for (const comment of comments) {
    if (comment.in_reply_to_id != null && hasMarker(comment.body)) {
      answered.add(comment.in_reply_to_id);
    }
  }

  const roots = comments.filter((comment) => comment.in_reply_to_id == null);
  return {
    pending: roots.filter((comment) => !answered.has(comment.id) && !hasMarker(comment.body)),
    alreadyEvaluated: roots.filter((comment) => answered.has(comment.id)),
  };
}
