import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

export interface TestUser {
  id: string;
  email: string;
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly sqlState: string | undefined,
  ) {
    super(message);
  }
}

/**
 * An in-process Postgres with the Supabase shim and every Foreman migration
 * applied, plus helpers to act as a given API role.
 */
export class TestDatabase {
  private counter = 0;

  private constructor(public readonly pg: PGlite) {}

  static async create(): Promise<TestDatabase> {
    const pg = new PGlite();
    await pg.exec(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
    for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
      if (!file.endsWith(".sql")) continue;
      try {
        await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    return new TestDatabase(pg);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  /** Runs SQL as the database owner (bypasses RLS). For fixtures and assertions only. */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.pg.exec("reset role");
    const result = await this.pg.query<T>(sql, params);
    return result.rows;
  }

  /** Inserts an auth user the way Supabase Auth would; the signup trigger creates the profile. */
  async createUser(
    options: {
      verified?: boolean;
      email?: string;
      meta?: Record<string, unknown>;
    } = {},
  ): Promise<TestUser> {
    this.counter += 1;
    const email = options.email ?? `person${this.counter}@example.test`;
    const meta = options.meta ?? {
      first_name: `First${this.counter}`,
      last_name: `Last${this.counter}`,
      username: `person_${this.counter}`,
      avatar_gender_selection: this.counter % 2 === 0 ? "MALE" : "FEMALE",
    };
    const verified = options.verified ?? true;
    const rows = await this.admin<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
       values ($1, $2::jsonb, $3) returning id`,
      [email, JSON.stringify(meta), verified ? new Date().toISOString() : null],
    );
    return { id: rows[0].id, email };
  }

  private async actAs(user: TestUser | null): Promise<void> {
    await this.pg.exec("reset role");
    if (user) {
      await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: user.id, role: "authenticated" }),
      ]);
      await this.pg.exec("set role authenticated");
    } else {
      await this.pg.query(`select set_config('request.jwt.claims', '', false)`);
      await this.pg.exec("set role anon");
    }
  }

  /** Runs a query as `authenticated` with the user's JWT claims, or as `anon` when user is null. */
  async queryAs<T = Record<string, unknown>>(user: TestUser | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await this.actAs(user);
    try {
      const result = await this.pg.query<T>(sql, params);
      return result.rows;
    } catch (error) {
      const pgError = error as { message: string; code?: string };
      throw new RpcError(pgError.message, pgError.code);
    } finally {
      await this.pg.exec("reset role");
    }
  }

  /** Calls a function in `public` with named arguments, like PostgREST's /rpc endpoint. */
  async rpc<T = unknown>(user: TestUser | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const names = Object.keys(args);
    const placeholders = names.map((name, index) => {
      const value = args[name];
      const cast = value !== null && typeof value === "object" ? "::jsonb" : "";
      return `${name} => $${index + 1}${cast}`;
    });
    const params = names.map((name) => {
      const value = args[name];
      return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
    });
    const rows = await this.queryAs<{ result: T }>(
      user,
      `select public.${fn}(${placeholders.join(", ")}) as result`,
      params,
    );
    return rows[0].result;
  }

  /** Realtime authorises a channel by evaluating the realtime.messages policies for its topic. */
  async withTopic<T>(user: TestUser | null, topic: string, sql: string, params: unknown[] = []): Promise<T[]> {
    await this.pg.exec("reset role");
    await this.pg.query(`select set_config('realtime.topic', $1, false)`, [topic]);
    try {
      return await this.queryAs<T>(user, sql, params);
    } finally {
      await this.pg.query(`select set_config('realtime.topic', '', false)`);
    }
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}
