/** Exponential backoff with full jitter: a random delay in [0, min(cap, base * 2^attempt)]. */
export function backoffDelay(
  attempt: number,
  options: { baseMs?: number; capMs?: number; random?: () => number } = {},
): number {
  const base = options.baseMs ?? 500;
  const cap = options.capMs ?? 30_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}
