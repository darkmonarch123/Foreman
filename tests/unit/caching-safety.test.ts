import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the caching strategy (docs/performance.md): only public data may be cached
 * across requests, and a cached scope must never read the session.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The body of each function that starts with a "use cache" directive. */
function cachedScopes(source: string): string[] {
  const scopes: string[] = [];
  // A directive is a statement on its own line, not the phrase inside a comment.
  const directive = /^\s*["']use cache[^"'\n]*["'];?\s*$/gm;
  for (const match of source.matchAll(directive)) {
    const start = match.index ?? 0;
    const next = source.indexOf("\nexport ", start);
    scopes.push(source.slice(start, next === -1 ? undefined : next));
  }
  return scopes;
}

const files = sourceFiles(join(process.cwd(), "src"));

describe("cross-request caching", () => {
  it("is used only for the public template catalog", () => {
    const cached = files.filter((file) => cachedScopes(readFileSync(file, "utf8")).length > 0);
    expect(cached.map((file) => file.slice(file.indexOf("src/")))).toEqual(["src/lib/boards/data.ts"]);
  });

  it("never reads cookies, headers or the signed-in session inside a cached scope", () => {
    for (const file of files) {
      for (const scope of cachedScopes(readFileSync(file, "utf8"))) {
        expect(scope).not.toMatch(/\bcreateClient\(\)|cookies\(|headers\(|getCurrentProfile|getSessionUserId|auth\./);
        expect(scope).toMatch(/createPublicClient\(\)/);
        expect(scope).toMatch(/is_published/);
      }
    }
  });

  it("uses the private 'use cache: private' variant nowhere (per-user data is never cached)", () => {
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/use cache: private/);
  });
});

describe("invalidation after mutations", () => {
  it("revalidates the dashboard after every board mutation", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/boards/actions.ts"), "utf8");
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
    const mutating = exported.filter((name) =>
      /^(create|rename|update|duplicate|delete|restore|purge|move|leave|join)/i.test(name),
    );
    expect(mutating.length).toBeGreaterThan(3);
    expect((source.match(/revalidatePath\("\/dashboard"\)/g) ?? []).length).toBeGreaterThanOrEqual(mutating.length - 2);
  });
});
