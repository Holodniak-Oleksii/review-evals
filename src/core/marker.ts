export const MARKER = '<!-- review-evals -->';

export function hasMarker(body: string | null | undefined): boolean {
  return body?.includes(MARKER) ?? false;
}
