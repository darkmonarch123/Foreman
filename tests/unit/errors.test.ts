import { describe, expect, it } from "vitest";
import { actionFailure, apiErrorBody, AppError, ERROR_CATALOG, toAppError } from "@/lib/errors";

describe("toAppError", () => {
  it("maps codes raised by database functions", () => {
    expect(toAppError({ code: "P0001", message: "BOARD_NOT_FOUND" }).code).toBe("BOARD_NOT_FOUND");
    expect(toAppError({ code: "P0001", message: "RATE_LIMITED" }).status).toBe(429);
    expect(toAppError({ code: "P0001", message: "EMAIL_NOT_VERIFIED" }).status).toBe(403);
  });

  it("maps Supabase Auth and PostgREST errors", () => {
    expect(toAppError({ code: "invalid_credentials", message: "Invalid login credentials" }).code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(toAppError({ code: "email_not_confirmed" }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(toAppError({ code: "weak_password" }).code).toBe("WEAK_PASSWORD");
    expect(toAppError({ code: "over_email_send_rate_limit" }).code).toBe("RATE_LIMITED");
    expect(toAppError({ code: "otp_expired" }).code).toBe("RECOVERY_LINK_INVALID");
    expect(toAppError({ code: "42501", message: "permission denied for table boards" }).code).toBe("UNAUTHENTICATED");
    expect(toAppError(new TypeError("Failed to fetch")).code).toBe("NETWORK");
  });

  it("never passes internal detail through to people", () => {
    const leaky = toAppError({
      code: "XX000",
      message: 'relation "public.secret_table" does not exist at character 15',
      details: "stack trace here",
      hint: "password=hunter2",
    });
    expect(leaky.code).toBe("UNKNOWN");
    expect(leaky.message).toBe(ERROR_CATALOG.UNKNOWN.message);
    expect(JSON.stringify(actionFailure(leaky))).not.toMatch(/secret_table|hunter2|stack/);
  });

  it("does not treat an arbitrary upper-case word in a message as a code", () => {
    expect(toAppError({ code: "22P02", message: "invalid input syntax for type uuid: BOARD_NOT_FOUND" }).code).toBe(
      "VALIDATION_FAILED",
    );
    expect(toAppError({ message: "Something mentioning RATE_LIMITED in passing" }).code).toBe("UNKNOWN");
  });

  it("uses one message for a missing board and a forbidden one's existence", () => {
    expect(ERROR_CATALOG.BOARD_NOT_FOUND.message).toBe("Board not found or access is unavailable.");
  });

  it("passes AppError through unchanged", () => {
    const original = new AppError("USERNAME_TAKEN");
    expect(toAppError(original)).toBe(original);
  });
});

describe("apiErrorBody", () => {
  it("produces the documented error format", () => {
    const body = apiErrorBody(new AppError("BOARD_ACCESS_DENIED"), "/api/boards/123", { requestId: "req-1" });
    expect(body).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      status: 403,
      code: "BOARD_ACCESS_DENIED",
      message: "You do not have access to this board.",
      path: "/api/boards/123",
      requestId: "req-1",
    });
  });

  it("carries field errors for validation failures and no stack", () => {
    const body = apiErrorBody(new AppError("VALIDATION_FAILED"), "/api/x", {
      fields: { title: "Give the board a name." },
    });
    expect(body.status).toBe(422);
    expect(body.fields).toEqual({ title: "Give the board a name." });
    expect(Object.keys(body)).not.toContain("stack");
  });
});
