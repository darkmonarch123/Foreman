import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions with Supabase mocked at the client boundary. These check
 * what the actions send, what they refuse, and that their responses do not
 * reveal whether an account exists. They do not exercise Supabase itself.
 */

const mocks = vi.hoisted(() => {
  const auth = {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    resend: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    getClaims: vi.fn(),
  };
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const cookieJar = new Map<string, string>();
  return {
    auth,
    rpc,
    maybeSingle,
    cookieJar,
    profile: { current: null as null | Record<string, unknown> },
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: mocks.auth,
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}));
vi.mock("@/lib/auth/dal", () => ({ getCurrentProfile: async () => mocks.profile.current }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookieJar.has(name) ? { name, value: mocks.cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => void mocks.cookieJar.set(name, value),
    delete: (name: string) => void mocks.cookieJar.delete(name),
    getAll: () => [],
  }),
}));

import {
  changePasswordAction,
  deleteAccountAction,
  forgotPasswordAction,
  loginAction,
  registerAction,
  resendVerificationAction,
  resetPasswordAction,
  updateProfileAction,
  verifyEmailAction,
} from "@/lib/auth/actions";
import { RECOVERY_COOKIE } from "@/lib/auth/constants";
import { createBoardAction, joinBoardAction, leaveBoardAction, updateBoardAction } from "@/lib/boards/actions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const registration = {
  firstName: "Ada",
  lastName: "Okafor",
  username: "ada_o",
  email: "Ada@Example.test",
  password: "correct horse 9",
  confirmPassword: "correct horse 9",
  avatarPreference: "FEMALE",
};

beforeEach(() => {
  for (const fn of Object.values(mocks.auth)) fn.mockReset();
  mocks.rpc.mockReset();
  mocks.maybeSingle.mockReset();
  mocks.redirect.mockClear();
  mocks.revalidatePath.mockClear();
  mocks.cookieJar.clear();
  mocks.profile.current = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://foreman.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registerAction", () => {
  it("re-validates on the server", async () => {
    const result = await registerAction({ ...registration, password: "short", confirmPassword: "short" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(mocks.auth.signUp).not.toHaveBeenCalled();
  });

  it("signs up through Supabase Auth with profile metadata and an exact redirect URL", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.auth.signUp.mockResolvedValue({ data: {}, error: null });
    const result = await registerAction(registration);
    expect(result).toEqual({ ok: true, data: { email: "ada@example.test" } });
    expect(mocks.auth.signUp).toHaveBeenCalledWith({
      email: "ada@example.test",
      password: "correct horse 9",
      options: {
        emailRedirectTo: "https://foreman.example/auth/confirm?next=/welcome",
        data: { first_name: "Ada", last_name: "Okafor", username: "ada_o", avatar_gender_selection: "FEMALE" },
      },
    });
  });

  it("gives the same result when the email is already registered", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.auth.signUp.mockResolvedValue({
      data: null,
      error: { code: "user_already_exists", message: "User already registered" },
    });
    const result = await registerAction(registration);
    expect(result).toEqual({ ok: true, data: { email: "ada@example.test" } });
  });

  it("reports a taken username against the field", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await registerAction(registration);
    expect(result).toMatchObject({ ok: false, code: "USERNAME_TAKEN", fields: { username: expect.any(String) } });
    expect(mocks.auth.signUp).not.toHaveBeenCalled();
  });

  it("never returns or logs the password or the email address", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.auth.signUp.mockResolvedValue({
      data: null,
      error: { code: "unexpected_failure", message: "boom correct horse 9 ada@example.test" },
    });
    const result = await registerAction(registration);
    expect(JSON.stringify(result)).not.toContain("correct horse 9");
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("correct horse 9");
    expect(logged).not.toContain("ada@example.test");
  });
});

describe("loginAction", () => {
  it("returns one generic error for a wrong password, an unknown email and anything unexpected", async () => {
    const outcomes = [];
    for (const error of [
      { code: "invalid_credentials", message: "Invalid login credentials" },
      { code: "user_not_found", message: "User not found" },
      { code: "unexpected_failure", message: "db exploded" },
    ]) {
      mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error });
      outcomes.push(await loginAction({ email: "a@b.co", password: "whatever" }));
    }
    expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size).toBe(1);
    expect(outcomes[0]).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("only ever redirects to a same-origin path", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { status: "ACTIVE" }, error: null });
    expect(await loginAction({ email: "a@b.co", password: "x", next: "https://evil.example/phish" })).toEqual({
      ok: true,
      data: { redirectTo: "/dashboard" },
    });
    expect(await loginAction({ email: "a@b.co", password: "x", next: "/boards/abc" })).toEqual({
      ok: true,
      data: { redirectTo: "/boards/abc" },
    });
  });

  it("refuses accounts that are pending deletion, with the generic error, and signs them out", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { status: "PENDING_DELETION" }, error: null });
    expect(await loginAction({ email: "a@b.co", password: "x" })).toMatchObject({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(mocks.auth.signOut).toHaveBeenCalled();
  });
});

describe("password recovery", () => {
  it("answers the same whether or not the email exists", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    const known = await forgotPasswordAction({ email: "known@example.test" });
    mocks.auth.resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { code: "user_not_found", message: "no user" },
    });
    const unknown = await forgotPasswordAction({ email: "unknown@example.test" });
    expect(known).toEqual(unknown);
    expect(known).toEqual({ ok: true, data: undefined });
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("known@example.test", {
      redirectTo: "https://foreman.example/auth/confirm?next=/reset-password",
    });
  });

  it("answers the same for resend-verification", async () => {
    mocks.auth.resend.mockResolvedValueOnce({ data: {}, error: null });
    const a = await resendVerificationAction({ email: "a@example.test" });
    mocks.auth.resend.mockResolvedValueOnce({ data: null, error: { code: "email_address_invalid", message: "x" } });
    const b = await resendVerificationAction({ email: "b@example.test" });
    expect(a).toEqual(b);
  });

  it("still reports rate limiting, which is not account-specific", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    expect(await forgotPasswordAction({ email: "a@example.test" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("will not set a password without a recovery session from this browser", async () => {
    mocks.auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID } }, error: null });
    const input = { password: "brand new pass 1", confirmPassword: "brand new pass 1" };
    // Signed in, but no recovery marker.
    expect(await resetPasswordAction(input)).toMatchObject({ ok: false, code: "RECOVERY_LINK_INVALID" });
    // A marker for a different user.
    mocks.cookieJar.set(RECOVERY_COOKIE, "99999999-9999-4999-8999-999999999999");
    expect(await resetPasswordAction(input)).toMatchObject({ ok: false, code: "RECOVERY_LINK_INVALID" });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("sets the password with a valid recovery session, then ends every session", async () => {
    mocks.auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID } }, error: null });
    mocks.auth.updateUser.mockResolvedValue({ data: {}, error: null });
    mocks.cookieJar.set(RECOVERY_COOKIE, USER_ID);
    expect(await resetPasswordAction({ password: "brand new pass 1", confirmPassword: "brand new pass 1" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "brand new pass 1" });
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.cookieJar.has(RECOVERY_COOKIE)).toBe(false);
  });

  it("only accepts well-formed email verification tokens of the expected type", async () => {
    expect(await verifyEmailAction({ tokenHash: "short", type: "email" })).toMatchObject({ ok: false });
    expect(await verifyEmailAction({ tokenHash: "a".repeat(40), type: "recovery" })).toMatchObject({ ok: false });
    expect(mocks.auth.verifyOtp).not.toHaveBeenCalled();
    mocks.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
    expect(await verifyEmailAction({ tokenHash: "a".repeat(40), type: "email" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "a".repeat(40) });
  });
});

describe("account actions", () => {
  it("require a session", async () => {
    expect(await updateProfileAction({ firstName: "A", lastName: "B", username: "abc" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await changePasswordAction({
        currentPassword: "x",
        password: "brand new pass 1",
        confirmPassword: "brand new pass 1",
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await deleteAccountAction({ password: "x", confirmation: "DELETE MY ACCOUNT" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("checks the current password before changing it and signs out other devices", async () => {
    mocks.profile.current = { id: USER_ID, email: "ada@example.test" };
    mocks.auth.signInWithPassword.mockResolvedValueOnce({ data: null, error: { code: "invalid_credentials" } });
    const wrong = await changePasswordAction({
      currentPassword: "wrong",
      password: "brand new pass 1",
      confirmPassword: "brand new pass 1",
    });
    expect(wrong).toMatchObject({ ok: false, fields: { currentPassword: expect.any(String) } });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();

    mocks.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: null });
    mocks.auth.updateUser.mockResolvedValue({ data: {}, error: null });
    const ok = await changePasswordAction({
      currentPassword: "old password 1",
      password: "brand new pass 1",
      confirmPassword: "brand new pass 1",
    });
    expect(ok).toEqual({ ok: true, data: undefined });
    expect(mocks.auth.signInWithPassword).toHaveBeenLastCalledWith({
      email: "ada@example.test",
      password: "old password 1",
    });
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("deletes an account only with the password and the typed phrase, then signs out everywhere", async () => {
    mocks.profile.current = { id: USER_ID, email: "ada@example.test" };
    expect(await deleteAccountAction({ password: "x", confirmation: "delete my account" })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });

    mocks.auth.signInWithPassword.mockResolvedValueOnce({ data: null, error: { code: "invalid_credentials" } });
    expect(await deleteAccountAction({ password: "wrong", confirmation: "DELETE MY ACCOUNT" })).toMatchObject({
      ok: false,
      fields: { password: expect.any(String) },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await deleteAccountAction({ password: "right", confirmation: "DELETE MY ACCOUNT" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("request_account_deletion", { p_confirmation: "DELETE MY ACCOUNT" });
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("surfaces the ownership-transfer requirement and does not sign the person out", async () => {
    mocks.profile.current = { id: USER_ID, email: "ada@example.test" };
    mocks.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "OWNED_BOARDS_REQUIRE_TRANSFER" } });
    expect(await deleteAccountAction({ password: "right", confirmation: "DELETE MY ACCOUNT" })).toMatchObject({
      ok: false,
      code: "OWNED_BOARDS_REQUIRE_TRANSFER",
    });
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("board actions", () => {
  it("require a session and never send a caller-chosen user id", async () => {
    expect(await createBoardAction({ title: "Plan", accessMode: "PRIVATE" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });

    mocks.profile.current = { id: USER_ID };
    mocks.rpc.mockResolvedValue({ data: { id: BOARD_ID, collaboration_code: "F-1WE-23XX" }, error: null });
    await createBoardAction({
      title: " Foreman Launch Plan ",
      accessMode: "PRIVATE",
      templateSlug: "project-roadmap",
      owner_id: "someone-else",
      role: "OWNER",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_board", {
      p_title: "Foreman Launch Plan",
      p_description: "",
      p_access_mode: "PRIVATE",
      p_template_slug: "project-roadmap",
    });
  });

  it("uses the session's own id when leaving a board, whatever the client sends", async () => {
    mocks.profile.current = { id: USER_ID };
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await leaveBoardAction({ boardId: BOARD_ID, userId: "99999999-9999-4999-8999-999999999999" });
    expect(mocks.rpc).toHaveBeenCalledWith("remove_member", { p_board_id: BOARD_ID, p_user_id: USER_ID });
  });

  it("validates ids before touching the database", async () => {
    mocks.profile.current = { id: USER_ID };
    expect(await updateBoardAction({ boardId: "not-a-uuid", title: "x" })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await leaveBoardAction({ boardId: "'; drop table boards; --" })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes database authorization errors through as safe messages", async () => {
    mocks.profile.current = { id: USER_ID };
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "BOARD_ACCESS_DENIED" } });
    expect(await updateBoardAction({ boardId: BOARD_ID, title: "Renamed" })).toEqual({
      ok: false,
      code: "BOARD_ACCESS_DENIED",
      message: "You do not have access to this board.",
    });
  });

  it("normalises collaboration codes and gives malformed ones the generic answer without a lookup", async () => {
    mocks.profile.current = { id: USER_ID };
    mocks.rpc.mockResolvedValue({ data: { status: "UNAVAILABLE" }, error: null });
    await joinBoardAction({ code: "  f-1we-23xx \n" });
    expect(mocks.rpc).toHaveBeenCalledWith("join_board", { p_code: "F-1WE-23XX", p_token: null });

    mocks.rpc.mockClear();
    expect(await joinBoardAction({ code: "hello" })).toEqual({ ok: true, data: { status: "UNAVAILABLE" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
