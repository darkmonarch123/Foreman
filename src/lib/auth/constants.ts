/**
 * Short-lived, httpOnly marker set by /auth/confirm after a password-recovery
 * link has been verified. Its value is the user id the recovery was for, and
 * the reset action checks it against the session, so only a browser that just
 * followed a valid recovery link can set a new password without the old one.
 */
export const RECOVERY_COOKIE = "fm_recovery";
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60;
