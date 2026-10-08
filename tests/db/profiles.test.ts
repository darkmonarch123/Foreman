import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, expectDenied } from "./fixtures";
import { TestDatabase } from "./harness";

let db: TestDatabase;
beforeAll(async () => {
  db = await TestDatabase.create();
});
afterAll(async () => {
  await db.close();
});

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  email_verified: boolean;
  avatar_url: string;
  avatar_seed: string;
  avatar_gender_selection: string;
  plan: string;
  status: string;
}

describe("profile creation", () => {
  it("creates a profile from signup metadata", async () => {
    const user = await db.createUser({
      email: "Ada@Example.test",
      verified: false,
      meta: { first_name: " Ada ", last_name: "Okafor", username: "Ada_O", avatar_gender_selection: "female" },
    });
    const [profile] = await db.queryAs<Profile>(user, "select * from public.profiles");
    expect(profile).toMatchObject({
      id: user.id,
      first_name: "Ada",
      last_name: "Okafor",
      username: "ada_o",
      email: "ada@example.test",
      email_verified: false,
      avatar_gender_selection: "FEMALE",
      plan: "FREE",
      status: "ACTIVE",
    });
    expect(profile.avatar_url).toBe(`/api/avatar/female/${profile.avatar_seed}`);
  });

  it("never puts the email address in the avatar URL or seed", async () => {
    const user = await db.createUser({ email: "private.person@example.test" });
    const [profile] = await db.queryAs<Profile>(user, "select * from public.profiles");
    expect(profile.avatar_url).not.toContain("private");
    expect(profile.avatar_seed).toMatch(/^[a-z0-9]{16}$/);
  });

  it("replaces invalid or hostile metadata instead of failing the signup", async () => {
    const user = await db.createUser({
      meta: {
        first_name: "",
        username: "<script>alert(1)</script>",
        avatar_gender_selection: "robot",
        plan: "PRO",
        status: "DELETED",
      },
    });
    const [profile] = await db.queryAs<Profile>(user, "select * from public.profiles");
    expect(profile.first_name).toBe("New");
    expect(profile.username).toMatch(/^user_[a-z0-9]{10}$/);
    expect(["MALE", "FEMALE"]).toContain(profile.avatar_gender_selection);
    expect(profile.plan).toBe("FREE");
    expect(profile.status).toBe("ACTIVE");
  });

  it("keeps usernames unique when two signups ask for the same one", async () => {
    const first = await db.createUser({ meta: { first_name: "A", last_name: "B", username: "taken_name" } });
    const second = await db.createUser({ meta: { first_name: "C", last_name: "D", username: "taken_name" } });
    const [a] = await db.queryAs<Profile>(first, "select * from public.profiles");
    const [b] = await db.queryAs<Profile>(second, "select * from public.profiles");
    expect(a.username).toBe("taken_name");
    expect(b.username).toMatch(/^taken_name_[a-z0-9]{4}$/);
  });

  it("is idempotent for the same auth user", async () => {
    const user = await db.createUser();
    await db.admin("update auth.users set raw_user_meta_data = raw_user_meta_data where id = $1", [user.id]);
    const rows = await db.admin("select 1 from public.profiles where id = $1", [user.id]);
    expect(rows).toHaveLength(1);
  });

  it("mirrors email verification from auth.users", async () => {
    const user = await db.createUser({ verified: false });
    await db.admin("update auth.users set email_confirmed_at = now() where id = $1", [user.id]);
    const [profile] = await db.queryAs<Profile>(user, "select * from public.profiles");
    expect(profile.email_verified).toBe(true);
  });
});

describe("profile access", () => {
  it("lets a user read only their own profile", async () => {
    const me = await db.createUser();
    await db.createUser();
    const rows = await db.queryAs<Profile>(me, "select * from public.profiles");
    expect(rows.map((row) => row.id)).toEqual([me.id]);
  });

  it("exposes no profiles to anonymous visitors", async () => {
    await expectDenied(db.queryAs(null, "select * from public.profiles"));
  });

  it("refuses direct writes to profiles", async () => {
    const me = await db.createUser();
    await expectDenied(db.queryAs(me, "update public.profiles set plan = 'PRO'"));
    await expectDenied(db.queryAs(me, "update public.profiles set email_verified = true"));
    await expectDenied(db.queryAs(me, "delete from public.profiles"));
  });

  it("updates name and username through update_profile", async () => {
    const me = await db.createUser();
    const profile = await db.rpc<Profile>(me, "update_profile", {
      p_first_name: "Temi",
      p_last_name: "Adeyemi",
      p_username: "Temi_A",
    });
    expect(profile).toMatchObject({ first_name: "Temi", last_name: "Adeyemi", username: "temi_a" });
  });

  it("rejects a username that someone else holds", async () => {
    const holder = await db.createUser({ meta: { first_name: "A", last_name: "B", username: "held_name" } });
    const me = await db.createUser();
    expect(holder.id).toBeTruthy();
    await expectCode(
      db.rpc(me, "update_profile", { p_first_name: "A", p_last_name: "B", p_username: "held_name" }),
      "USERNAME_TAKEN",
    );
    await expectCode(
      db.rpc(me, "update_profile", { p_first_name: "A", p_last_name: "B", p_username: "no spaces!" }),
      "VALIDATION_FAILED",
    );
  });

  it("reports username availability, including to anonymous visitors", async () => {
    await db.createUser({ meta: { first_name: "A", last_name: "B", username: "in_use" } });
    expect(await db.rpc(null, "username_available", { p_username: "in_use" })).toBe(false);
    expect(await db.rpc(null, "username_available", { p_username: "IN_USE" })).toBe(false);
    expect(await db.rpc(null, "username_available", { p_username: "free_name" })).toBe(true);
    expect(await db.rpc(null, "username_available", { p_username: "x" })).toBe(false);
  });
});

describe("avatars", () => {
  it("regenerates the avatar with a new seed", async () => {
    const me = await db.createUser({ meta: { first_name: "A", last_name: "B", avatar_gender_selection: "MALE" } });
    const [before] = await db.queryAs<Profile>(me, "select * from public.profiles");
    const after = await db.rpc<Profile>(me, "regenerate_avatar");
    expect(after.avatar_seed).not.toBe(before.avatar_seed);
    expect(after.avatar_gender_selection).toBe("MALE");
    expect(after.avatar_url).toBe(`/api/avatar/male/${after.avatar_seed}`);
  });

  it("changes the initial avatar preference on request", async () => {
    const me = await db.createUser({ meta: { first_name: "A", last_name: "B", avatar_gender_selection: "MALE" } });
    const after = await db.rpc<Profile>(me, "regenerate_avatar", { p_gender: "FEMALE" });
    expect(after.avatar_gender_selection).toBe("FEMALE");
    expect(after.avatar_url).toMatch(/^\/api\/avatar\/female\//);
    await expectCode(db.rpc(me, "regenerate_avatar", { p_gender: "OTHER" }), "VALIDATION_FAILED");
  });

  it("cannot be pointed at an external URL", async () => {
    const me = await db.createUser();
    await expect(
      db.admin("update public.profiles set avatar_url = 'https://tracker.example/pixel.png' where id = $1", [me.id]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("unauthenticated callers", () => {
  it("cannot call account or board functions", async () => {
    await expectDenied(db.rpc(null, "create_board", { p_title: "x" }));
    await expectDenied(db.rpc(null, "regenerate_avatar"));
    await expectDenied(db.rpc(null, "export_my_data"));
    await expectDenied(db.rpc(null, "list_boards"));
  });
});
