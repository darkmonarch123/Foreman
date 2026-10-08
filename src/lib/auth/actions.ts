"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionFailure, actionSuccess, AppError, toAppError, type ActionResult } from "@/lib/errors";
import { getPublicEnv, getSiteUrl } from "@/lib/env";
import { logServerError, newRequestId } from "@/lib/log";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "./constants";
import { getCurrentProfile } from "./dal";
import {
  changePasswordSchema,
  deleteAccountSchema,
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from "./schemas";
import type { Profile } from "./types";

/**
 * Authentication and account Server Actions.
 *
 * Rules that hold for every action here:
 *   - input is re-validated on the server with the same Zod schema the form uses
 *   - the acting user comes from the session, never from the arguments
 *   - passwords and tokens are passed straight to Supabase Auth and are never
 *     logged, stored or returned
 *   - responses that could reveal whether an account exists are generic
 */

function notConfigured(): ActionResult<never> {
  return actionFailure(new AppError("NOT_CONFIGURED"));
}

export async function registerAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  if (!getPublicEnv()) return notConfigured();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const { firstName, lastName, username, email, password, avatarPreference } = parsed.data;
  const requestId = newRequestId();
  const supabase = await createClient();

  // Usernames are public handles, so telling someone a handle is taken does
  // not reveal anything private.
  const { data: available, error: availabilityError } = await supabase.rpc("username_available", {
    p_username: username,
  });
  if (availabilityError) {
    logServerError("auth.register.username", availabilityError, requestId);
    return actionFailure(availabilityError);
  }
  if (available === false) {
    return actionFailure(new AppError("USERNAME_TAKEN"), { username: new AppError("USERNAME_TAKEN").message });
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/welcome`,
      // Read by the database trigger that creates the profile. The trigger
      // validates every field again.
      data: {
        first_name: firstName,
        last_name: lastName,
        username,
        avatar_gender_selection: avatarPreference,
      },
    },
  });

  if (error) {
    const appError = toAppError(error);
    if (appError.code === "WEAK_PASSWORD") {
      return actionFailure(appError, { password: appError.message });
    }
    if (appError.code === "RATE_LIMITED") return actionFailure(appError);
    logServerError("auth.register", error, requestId);
    // Anything else (including "already registered") gets the same outcome as
    // success so the form cannot be used to test which emails have accounts.
  }
  return actionSuccess({ email });
}

export async function loginAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  if (!getPublicEnv()) return notConfigured();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    const appError = toAppError(error);
    if (appError.code === "EMAIL_NOT_VERIFIED") {
      // Supabase only reports this after the password matched, so it does not
      // help anyone probe for accounts.
      return actionFailure(appError);
    }
    if (appError.code === "RATE_LIMITED" || appError.code === "NETWORK") return actionFailure(appError);
    // One message for wrong password, unknown email and everything else.
    return actionFailure(new AppError("INVALID_CREDENTIALS"));
  }

  const { data: profile } = await supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.status !== "ACTIVE") {
    await supabase.auth.signOut();
    return actionFailure(new AppError("INVALID_CREDENTIALS"));
  }

  return actionSuccess({ redirectTo: safeNextPath(parsed.data.next, "/dashboard") });
}

export async function logoutAction(): Promise<void> {
  if (getPublicEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/** Signs out every session for this account on every device. */
export async function logoutEverywhereAction(): Promise<void> {
  if (getPublicEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "global" });
  }
  redirect("/login");
}

export async function forgotPasswordAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "RATE_LIMITED") return actionFailure(appError);
    logServerError("auth.forgot", error);
  }
  // Always the same answer, whether or not the address has an account.
  return actionSuccess();
}

export async function resendVerificationAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/welcome` },
  });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "RATE_LIMITED") return actionFailure(appError);
    logServerError("auth.resend", error);
  }
  return actionSuccess();
}

/**
 * Verifies an email-confirmation link. The token hash is used once, on the
 * server, and is never echoed back.
 */
export async function verifyEmailAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const tokenHash = (input as { tokenHash?: unknown } | null)?.tokenHash;
  const type = (input as { type?: unknown } | null)?.type;
  if (typeof tokenHash !== "string" || tokenHash.length < 16 || tokenHash.length > 256) {
    return actionFailure(new AppError("RECOVERY_LINK_INVALID"));
  }
  if (type !== "email" && type !== "signup") {
    return actionFailure(new AppError("RECOVERY_LINK_INVALID"));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return actionFailure(new AppError("RECOVERY_LINK_INVALID"));
  }
  return actionSuccess();
}

/**
 * Sets a new password from a recovery link. Requires the recovery session
 * established by /auth/confirm; an ordinary logged-in session is not enough.
 */
export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const cookieStore = await cookies();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub || cookieStore.get(RECOVERY_COOKIE)?.value !== claims.claims.sub) {
    return actionFailure(new AppError("RECOVERY_LINK_INVALID"));
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "WEAK_PASSWORD" || appError.code === "SAME_PASSWORD") {
      return actionFailure(appError, { password: appError.message });
    }
    logServerError("auth.reset", error);
    return actionFailure(appError.code === "UNAUTHENTICATED" ? new AppError("RECOVERY_LINK_INVALID") : appError);
  }

  cookieStore.delete(RECOVERY_COOKIE);
  // A reset ends every existing session, including this recovery session.
  await supabase.auth.signOut({ scope: "global" });
  return actionSuccess();
}

export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();

  // Confirm the current password before allowing a change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.currentPassword,
  });
  if (reauthError) {
    const appError = toAppError(reauthError);
    if (appError.code === "RATE_LIMITED") return actionFailure(appError);
    return actionFailure(new AppError("INVALID_CREDENTIALS"), {
      currentPassword: "That isn't your current password.",
    });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "WEAK_PASSWORD" || appError.code === "SAME_PASSWORD") {
      return actionFailure(appError, { password: appError.message });
    }
    logServerError("auth.change-password", error);
    return actionFailure(appError);
  }
  // Every other device is signed out; this one stays signed in.
  await supabase.auth.signOut({ scope: "others" });
  return actionSuccess();
}

export async function updateProfileAction(input: unknown): Promise<ActionResult<Profile>> {
  if (!getPublicEnv()) return notConfigured();
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_profile", {
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_username: parsed.data.username,
  });
  if (error) {
    const appError = toAppError(error);
    return actionFailure(appError, appError.code === "USERNAME_TAKEN" ? { username: appError.message } : undefined);
  }
  return actionSuccess(data as Profile);
}

export async function regenerateAvatarAction(input?: unknown): Promise<ActionResult<Profile>> {
  if (!getPublicEnv()) return notConfigured();
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const preference = (input as { preference?: unknown } | undefined)?.preference;
  if (preference !== undefined && preference !== "MALE" && preference !== "FEMALE") {
    return actionFailure(new AppError("VALIDATION_FAILED"));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regenerate_avatar", { p_gender: preference ?? null });
  if (error) return actionFailure(error);
  return actionSuccess(data as Profile);
}

export async function updateNotificationPrefsAction(input: unknown): Promise<ActionResult<Record<string, boolean>>> {
  if (!getPublicEnv()) return notConfigured();
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  if (!input || typeof input !== "object") return actionFailure(new AppError("VALIDATION_FAILED"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_notification_prefs", { p_prefs: input });
  if (error) return actionFailure(error);
  return actionSuccess(data as Record<string, boolean>);
}

/**
 * Account deletion: password re-check, typed confirmation, soft delete in the
 * database, then every session is revoked.
 */
export async function deleteAccountAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return notConfigured();
  const profile = await getCurrentProfile();
  if (!profile) return actionFailure(new AppError("UNAUTHENTICATED"));
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(new AppError("VALIDATION_FAILED"), fieldErrors(parsed.error));
  }
  const supabase = await createClient();

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.password,
  });
  if (reauthError) {
    const appError = toAppError(reauthError);
    if (appError.code === "RATE_LIMITED") return actionFailure(appError);
    return actionFailure(new AppError("INVALID_CREDENTIALS"), { password: "That isn't your password." });
  }

  const { error } = await supabase.rpc("request_account_deletion", { p_confirmation: parsed.data.confirmation });
  if (error) return actionFailure(error);

  await supabase.auth.signOut({ scope: "global" });
  return actionSuccess();
}

export async function recordCookieConsentAction(input: unknown): Promise<ActionResult> {
  if (!getPublicEnv()) return actionSuccess();
  const profile = await getCurrentProfile();
  // Signed-out visitors keep their choice in the browser only.
  if (!profile) return actionSuccess();
  const value = input as { version?: unknown; analytics?: unknown; preferences?: unknown } | null;
  if (!value || typeof value.version !== "string") return actionFailure(new AppError("VALIDATION_FAILED"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cookie_consent", {
    p_version: value.version,
    p_analytics: value.analytics === true,
    p_preferences: value.preferences === true,
  });
  if (error) return actionFailure(error);
  return actionSuccess();
}
