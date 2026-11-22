export function added<T>(before: readonly T[], after: readonly T[], key: (item: T) => string): T[] {
  const remaining = new Map<string, number>();
  for (const item of before) {
    const k = key(item);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }

  const result: T[] = [];
  for (const item of after) {
    const k = key(item);
    const count = remaining.get(k) ?? 0;
    if (count > 0) remaining.set(k, count - 1);
    else result.push(item);
  }
  return result;
}
