import {
  hasMarker,
  itemId,
  parseRecommendation,
  parseReplyData,
  type DatasetItem,
  type ReviewComment,
} from '../core';

export function collectItems(repo: string, pullNumber: number, comments: readonly ReviewComment[]): DatasetItem[] {
  const replies = new Map<number, ReviewComment>();
  for (const comment of comments) {
    if (comment.in_reply_to_id != null && hasMarker(comment.body)) replies.set(comment.in_reply_to_id, comment);
  }

  return comments
    .filter((comment) => comment.in_reply_to_id == null && !hasMarker(comment.body))
    .map((comment) => {
      const parsed = parseRecommendation(comment);
      const data = parseReplyData(replies.get(comment.id)?.body);
      const recommendation = data ? { ...parsed, ...data.recommendation, body: parsed.body } : parsed;
      return {
        id: itemId(repo, pullNumber, parsed.id),
        repo,
        pullNumber,
        recommendation,
        results: data?.results ?? null,
        label: null,
        note: '',
      };
    });
}
