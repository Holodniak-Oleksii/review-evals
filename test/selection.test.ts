import { describe, expect, it } from 'vitest';
import { MARKER, selectPendingComments } from '../src/core';
import { makeComment } from './helpers';

describe('selectPendingComments', () => {
  it('ігнорує відповіді', () => {
    const root = makeComment({ id: 1 });
    const reply = makeComment({ id: 2, in_reply_to_id: 1, body: 'Згоден.' });

    const { pending } = selectPendingComments([root, reply]);

    expect(pending.map((c) => c.id)).toEqual([1]);
  });

  it('пропускає коментар, під яким уже є відповідь з маркером', () => {
    const evaluated = makeComment({ id: 1 });
    const ourReply = makeComment({ id: 2, in_reply_to_id: 1, body: `${MARKER}\nрезультат` });
    const fresh = makeComment({ id: 3 });

    const { pending, alreadyEvaluated } = selectPendingComments([evaluated, ourReply, fresh]);

    expect(pending.map((c) => c.id)).toEqual([3]);
    expect(alreadyEvaluated.map((c) => c.id)).toEqual([1]);
  });

  it('оцінює коментар, під яким є лише відповідь людини', () => {
    const root = makeComment({ id: 1 });
    const humanReply = makeComment({ id: 2, in_reply_to_id: 1, body: 'Дякую!' });

    expect(selectPendingComments([root, humanReply]).pending.map((c) => c.id)).toEqual([1]);
  });
});
