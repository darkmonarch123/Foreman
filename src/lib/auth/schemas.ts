import { z } from "zod";

/** Validation shared by the browser forms and the server actions. */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export const PASSWORD_MIN_LENGTH = 10;

const name = (label: string) =>
  z.string().trim().min(1, `Enter your ${label}.`).max(60, `Keep your ${label} under 60 characters.`);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, "Use 72 characters or fewer.")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "Include at least one letter and one number.");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(24, "Use 24 characters or fewer.")
  .regex(USERNAME_PATTERN, "Use lowercase letters, numbers and underscores only.");

export const avatarPreferenceSchema = z.enum(["MALE", "FEMALE"], {
  error: "Choose an initial avatar.",
});

export const registerSchema = z
  .object({
    firstName: name("first name"),
    lastName: name("last name"),
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
    avatarPreference: avatarPreferenceSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Do not reveal the password policy on the login form.
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  })
  .refine((data) => data.password !== data.currentPassword, {
    path: ["password"],
    message: "Choose a password you haven't used for this account.",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  firstName: name("first name"),
  lastName: name("last name"),
  username: usernameSchema,
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password.").max(200),
  confirmation: z.literal(DELETE_CONFIRMATION, { error: `Type ${DELETE_CONFIRMATION} to confirm.` }),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/** Flattens a Zod error into `{ field: firstMessage }`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
