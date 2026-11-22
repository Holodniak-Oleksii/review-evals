export const MODES = ['annotate', 'filter', 'hybrid'] as const;

export type Mode = (typeof MODES)[number];

export function parseMode(value: string | undefined): Mode {
  const normalized = (value ?? '').trim().toLowerCase() || 'annotate';
  const mode = MODES.find((m) => m === normalized);
  if (mode === undefined) {
    throw new Error(`Невідомий режим "${value}". Допустимі значення: ${MODES.join(', ')}.`);
  }
  return mode;
}
