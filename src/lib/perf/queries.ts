/**
 * Database round-trip timing for development and tests.
 *
 * Every call through the page data layer and the Assistant actions is counted
 * here, so tests can assert how many round trips a page makes, and development
 * logs show how long each took. Nothing is logged in production unless
 * FOREMAN_QUERY_TIMING=1. Only the function or table name is recorded.
 */

export interface QueryRecord {
  name: string;
  ms: number;
}

const records: QueryRecord[] = [];

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.FOREMAN_QUERY_TIMING === "1";
}

export async function timedQuery<T>(name: string, run: () => PromiseLike<T>): Promise<T> {
  if (!enabled()) return run();
  const started = performance.now();
  try {
    return await run();
  } finally {
    const ms = Math.round((performance.now() - started) * 10) / 10;
    records.push({ name, ms });
    if (records.length > 500) records.shift();
    if (process.env.NODE_ENV === "development") {
      console.debug(JSON.stringify({ level: "debug", scope: "db", name, ms }));
    }
  }
}

/** Test helper: the round trips recorded since the last reset. */
export function queryLog(): readonly QueryRecord[] {
  return records;
}

export function resetQueryLog(): void {
  records.length = 0;
}
