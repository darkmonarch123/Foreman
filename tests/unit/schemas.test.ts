import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  deleteAccountSchema,
  fieldErrors,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/auth/schemas";
import {
  commentSchema,
  createBoardSchema,
  inviteSchema,
  joinSchema,
  normalizeCollaborationCode,
} from "@/lib/boards/schemas";

const validRegistration = {
  firstName: "Ada",
  lastName: "Okafor",
  username: "ada_o",
  email: "Ada@Example.test",
  password: "correct horse 9",
  confirmPassword: "correct horse 9",
  avatarPreference: "FEMALE",
};

function errorsFor(input: Record<string, unknown>) {
  const result = registerSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

describe("registration", () => {
  it("accepts a valid form and normalises email and username", () => {
    const parsed = registerSchema.parse({ ...validRegistration, username: " Ada_O " });
    expect(parsed.email).toBe("ada@example.test");
    expect(parsed.username).toBe("ada_o");
  });

  it("requires every field", () => {
    const errors = errorsFor({});
    for (const field of [
      "firstName",
      "lastName",
      "username",
      "email",
      "password",
      "confirmPassword",
      "avatarPreference",
    ]) {
      expect(errors[field], field).toBeTruthy();
    }
  });

  it("validates the username format", () => {
    expect(errorsFor({ ...validRegistration, username: "ab" }).username).toMatch(/at least 3/);
    expect(errorsFor({ ...validRegistration, username: "has space" }).username).toMatch(/lowercase letters/);
    expect(errorsFor({ ...validRegistration, username: "x".repeat(25) }).username).toMatch(/24 characters/);
  });

  it("enforces the password policy and confirmation", () => {
    expect(errorsFor({ ...validRegistration, password: "short1", confirmPassword: "short1" }).password).toMatch(
      /at least 10/,
    );
    expect(
      errorsFor({ ...validRegistration, password: "onlyletters", confirmPassword: "onlyletters" }).password,
    ).toMatch(/letter and one number/);
    expect(errorsFor({ ...validRegistration, confirmPassword: "something else 1" }).confirmPassword).toBe(
      "The passwords don't match.",
    );
  });

  it("only accepts Male or Female for the initial avatar", () => {
    expect(errorsFor({ ...validRegistration, avatarPreference: "OTHER" }).avatarPreference).toBeTruthy();
    expect(registerSchema.safeParse({ ...validRegistration, avatarPreference: "MALE" }).success).toBe(true);
  });

  it("rejects invalid email addresses", () => {
    expect(errorsFor({ ...validRegistration, email: "not-an-email" }).email).toBe("Enter a valid email address.");
  });
});

describe("login and recovery", () => {
  it("does not reveal the password policy on the login form", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(fieldErrors(loginSchema.safeParse({ email: "a@b.co", password: "" }).error!).password).toBe(
      "Enter your password.",
    );
  });

  it("requires matching passwords to reset", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "new password 1", confirmPassword: "new password 1" }).success,
    ).toBe(true);
    expect(
      fieldErrors(resetPasswordSchema.safeParse({ password: "new password 1", confirmPassword: "nope" }).error!)
        .confirmPassword,
    ).toBeTruthy();
  });

  it("requires the current password and a different new one to change it", () => {
    const same = changePasswordSchema.safeParse({
      currentPassword: "old password 1",
      password: "old password 1",
      confirmPassword: "old password 1",
    });
    expect(fieldErrors(same.error!).password).toMatch(/haven't used/);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "",
        password: "new password 1",
        confirmPassword: "new password 1",
      }).success,
    ).toBe(false);
  });

  it("requires the exact phrase to delete an account", () => {
    expect(deleteAccountSchema.safeParse({ password: "x", confirmation: "DELETE MY ACCOUNT" }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ password: "x", confirmation: "delete my account" }).success).toBe(false);
  });
});

describe("boards", () => {
  it("validates board creation", () => {
    expect(createBoardSchema.parse({ title: "  Foreman Launch Plan ", accessMode: "PRIVATE" }).title).toBe(
      "Foreman Launch Plan",
    );
    expect(createBoardSchema.safeParse({ title: "   ", accessMode: "PRIVATE" }).success).toBe(false);
    expect(createBoardSchema.safeParse({ title: "x", accessMode: "PUBLIC" }).success).toBe(false);
    expect(
      createBoardSchema.safeParse({ title: "x", accessMode: "PRIVATE", templateSlug: "../etc/passwd" }).success,
    ).toBe(false);
  });

  it("normalises collaboration codes by trimming and upper-casing", () => {
    expect(normalizeCollaborationCode("  f-1we-23xx \n")).toBe("F-1WE-23XX");
    expect(normalizeCollaborationCode("f - 1we - 23xx")).toBe("F-1WE-23XX");
  });

  it("accepts a code or a token to join, never both and never neither", () => {
    expect(joinSchema.safeParse({ code: "F-1WE-23XX" }).success).toBe(true);
    expect(joinSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(joinSchema.safeParse({}).success).toBe(false);
    expect(joinSchema.safeParse({ code: "F-1WE-23XX", token: "a".repeat(64) }).success).toBe(false);
    expect(joinSchema.safeParse({ token: "not hex!" }).success).toBe(false);
  });

  it("only allows Editor or Viewer invitations", () => {
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "EDITOR" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "OWNER" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "nope", role: "VIEWER" }).success).toBe(false);
  });

  it("rejects empty comments", () => {
    expect(commentSchema.safeParse("  \n ").success).toBe(false);
    expect(commentSchema.safeParse("x".repeat(2001)).success).toBe(false);
    expect(commentSchema.parse("  hello ")).toBe("hello");
  });
});
