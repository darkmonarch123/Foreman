import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDatabase, type TestUser } from "./harness";

let db: TestDatabase;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  db = await TestDatabase.create();
  alice = await db.createUser();
  bob = await db.createUser();
});
afterAll(async () => {
  await db.close();
});

const themeOf = async (user: TestUser) =>
  (
    await db.admin<{ theme_preference: string }>("select theme_preference from public.profiles where id = $1", [
      user.id,
    ])
  )[0].theme_preference;

describe("set_theme_preference", () => {
  it("defaults to system and changes only the caller's own profile", async () => {
    expect(await themeOf(alice)).toBe("system");
    expect(await db.rpc(alice, "set_theme_preference", { p_theme: "dark" })).toBe("dark");
    expect(await themeOf(alice)).toBe("dark");
    expect(await themeOf(bob)).toBe("system");
  });

  it("rejects unknown themes and anonymous callers", async () => {
    await expect(db.rpc(alice, "set_theme_preference", { p_theme: "sepia" })).rejects.toThrow();
    await expect(db.rpc(null, "set_theme_preference", { p_theme: "dark" })).rejects.toThrow();
    await expect(
      db.admin("update public.profiles set theme_preference = 'neon' where id = $1", [bob.id]),
    ).rejects.toThrow();
  });
});
