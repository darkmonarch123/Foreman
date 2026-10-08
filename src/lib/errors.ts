/**
 * One error vocabulary for Server Actions, Route Handlers and the browser.
 *
 * Database functions raise a stable code as the exception message (for
 * example BOARD_NOT_FOUND). `toAppError` maps whatever came back to a code
 * with a human-friendly message; unknown failures collapse to a generic
 * message so no internal detail, SQL or stack trace reaches a person.
 */

export interface AppErrorInfo {
  status: number;
  message: string;
}

export const ERROR_CATALOG = {
  UNAUTHENTICATED: { status: 401, message: "Your session has expired. Log in again to continue." },
  ACCOUNT_INACTIVE: { status: 403, message: "This account is no longer active." },
  EMAIL_NOT_VERIFIED: { status: 403, message: "Verify your email address to use this feature." },
  VALIDATION_FAILED: { status: 422, message: "Some of that information isn't valid. Check it and try again." },
  RATE_LIMITED: { status: 429, message: "You're doing that too often. Wait a moment and try again." },
  NOT_CONFIGURED: { status: 503, message: "Foreman isn't connected to its database yet." },

  BOARD_NOT_FOUND: { status: 404, message: "Board not found or access is unavailable." },
  BOARD_ACCESS_DENIED: { status: 403, message: "You do not have access to this board." },
  BOARD_HAS_MEMBERS: { status: 409, message: "Remove the other members before making this board private." },
  BOARD_OBJECT_LIMIT: {
    status: 409,
    message: "This board has reached its object limit. Delete something to add more.",
  },
  TEMPLATE_NOT_FOUND: { status: 404, message: "That template is no longer available." },
  PLAN_REQUIRED: { status: 403, message: "That template isn't included in your plan." },
  CODE_GENERATION_FAILED: { status: 503, message: "A collaboration code couldn't be created. Try again." },
  SHARE_LINK_NOT_GENERATED: { status: 409, message: "Create a share link first." },

  MEMBER_NOT_FOUND: { status: 404, message: "That person isn't a member of this board." },
  INVALID_ROLE: { status: 422, message: "Choose Editor or Viewer." },
  CANNOT_CHANGE_OWN_ROLE: { status: 409, message: "You can't change your own role." },
  CANNOT_CHANGE_OWNER: { status: 409, message: "The owner's role can't be changed here. Transfer ownership instead." },
  OWNER_CANNOT_LEAVE: { status: 409, message: "The owner can't leave a board. Transfer ownership or delete it." },
  CANNOT_INVITE_SELF: { status: 409, message: "You're already on this board." },

  INVITATION_UNAVAILABLE: { status: 404, message: "This invitation isn't available." },
  INVITATION_EXPIRED: { status: 410, message: "This invitation has expired. Ask the board owner to send a new one." },
  INVITATION_REVOKED: { status: 410, message: "This invitation was withdrawn by the board owner." },
  INVITATION_ALREADY_ACCEPTED: { status: 409, message: "This invitation has already been accepted." },
  INVITATION_NOT_PENDING: { status: 409, message: "This invitation is no longer pending." },
  JOIN_REQUEST_NOT_FOUND: { status: 404, message: "That request is no longer waiting for a decision." },

  OBJECT_NOT_FOUND: { status: 404, message: "That item no longer exists on the board." },
  IMAGE_UPLOAD_DISABLED: { status: 403, message: "Image uploads aren't available yet." },
  COMMENT_NOT_FOUND: { status: 404, message: "That comment is no longer available." },
  COMMENTING_DISABLED: { status: 403, message: "Viewers can't comment on this board." },

  USERNAME_TAKEN: { status: 409, message: "That username is taken. Try another." },
  CONFIRMATION_MISMATCH: { status: 422, message: "Type the confirmation phrase exactly as shown." },
  OWNED_BOARDS_REQUIRE_TRANSFER: {
    status: 409,
    message: "You own boards that other people are on. Transfer ownership or remove the members first.",
  },
  INVALID_CREDENTIALS: { status: 401, message: "That email and password don't match. Check them and try again." },
  WEAK_PASSWORD: { status: 422, message: "Choose a stronger password." },
  SAME_PASSWORD: { status: 422, message: "Choose a password you haven't used for this account." },
  RECOVERY_LINK_INVALID: { status: 410, message: "This reset link is invalid or has expired. Request a new one." },
  NETWORK: { status: 503, message: "Foreman couldn't be reached. Check your connection and try again." },
  UNKNOWN: { status: 500, message: "Something went wrong on our side. Try again in a moment." },
} as const satisfies Record<string, AppErrorInfo>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_CATALOG[code].message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
  }
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

/** Normalises anything thrown or returned by Supabase into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const like = (error ?? {}) as ErrorLike;
  const message = typeof like.message === "string" ? like.message : "";
  const code = typeof like.code === "string" ? like.code : "";

  // Codes raised by our own database functions arrive as the message.
  const raised = message.match(/\b[A-Z][A-Z0-9_]{3,}\b/)?.[0];
  if (code === "P0001" && raised && isErrorCode(raised)) return new AppError(raised);
  if (raised && isErrorCode(raised) && message.trim() === raised) return new AppError(raised);

  // PostgREST / Postgres
  if (code === "42501" || code === "PGRST301" || like.status === 401) return new AppError("UNAUTHENTICATED");
  if (code === "23505" && /username/i.test(message)) return new AppError("USERNAME_TAKEN");
  if (code === "23514" || code === "22P02" || code === "23502") return new AppError("VALIDATION_FAILED");

  // Supabase Auth
  if (code === "invalid_credentials") return new AppError("INVALID_CREDENTIALS");
  if (code === "email_not_confirmed") return new AppError("EMAIL_NOT_VERIFIED");
  if (code === "weak_password") return new AppError("WEAK_PASSWORD");
  if (code === "same_password") return new AppError("SAME_PASSWORD");
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || like.status === 429) {
    return new AppError("RATE_LIMITED");
  }
  if (code === "otp_expired" || code === "flow_state_expired" || code === "flow_state_not_found") {
    return new AppError("RECOVERY_LINK_INVALID");
  }
  if (code === "session_not_found" || code === "refresh_token_not_found" || code === "bad_jwt") {
    return new AppError("UNAUTHENTICATED");
  }

  if (like.name === "TypeError" || /failed to fetch|network|fetch failed/i.test(message)) {
    return new AppError("NETWORK");
  }
  return new AppError("UNKNOWN");
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

/** The response body for failed Route Handlers and Edge Functions. */
export interface ApiErrorBody {
  timestamp: string;
  status: number;
  code: ErrorCode;
  message: string;
  path: string;
  requestId?: string;
  /** Present for validation failures: field name -> message. */
  fields?: Record<string, string>;
}

export function apiErrorBody(
  error: unknown,
  path: string,
  extra: { requestId?: string; fields?: Record<string, string> } = {},
): ApiErrorBody {
  const appError = toAppError(error);
  return {
    timestamp: new Date().toISOString(),
    status: appError.status,
    code: appError.code,
    message: appError.message,
    path,
    ...(extra.requestId ? { requestId: extra.requestId } : {}),
    ...(extra.fields ? { fields: extra.fields } : {}),
  };
}

/** The result shape every Server Action returns. Mirrors ApiErrorBody on failure. */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; fields?: Record<string, string> };

export function actionFailure(error: unknown, fields?: Record<string, string>): ActionResult<never> {
  const appError = toAppError(error);
  return { ok: false, code: appError.code, message: appError.message, ...(fields ? { fields } : {}) };
}

export function actionSuccess(): ActionResult<undefined>;
export function actionSuccess<T>(data: T): ActionResult<T>;
export function actionSuccess<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}
