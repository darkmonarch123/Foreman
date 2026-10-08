import { z } from "zod";

export const ACCESS_MODES = ["PRIVATE", "INVITE_ONLY", "LINK_VIEWER", "LINK_REQUEST_ACCESS"] as const;

export const ACCESS_MODE_LABELS: Record<(typeof ACCESS_MODES)[number], { label: string; description: string }> = {
  PRIVATE: { label: "Private", description: "Only you. Nobody can join with a code or link." },
  INVITE_ONLY: { label: "Invite only", description: "Only people you invite by email can join." },
  LINK_VIEWER: {
    label: "Anyone with the link can view",
    description: "Signed-in people with the share link or collaboration code join as viewers.",
  },
  LINK_REQUEST_ACCESS: {
    label: "Anyone with the link can request access",
    description: "Signed-in people with the link or code can ask to join. You approve each request.",
  },
};

export const boardTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the board a name.")
  .max(120, "Keep the name under 120 characters.");

export const createBoardSchema = z.object({
  title: boardTitleSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").optional().default(""),
  accessMode: z.enum(ACCESS_MODES),
  templateSlug: z
    .string()
    .regex(/^[a-z0-9-]{3,60}$/)
    .nullable()
    .optional(),
});

export type CreateBoardInput = z.input<typeof createBoardSchema>;

export const updateBoardSchema = z.object({
  boardId: z.uuid(),
  title: boardTitleSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").optional(),
});

export const boardIdSchema = z.object({ boardId: z.uuid() });

export const COLLABORATION_CODE_PATTERN = /^F-[A-Z0-9]{3}-[A-Z0-9]{4}$/;

/** Trims, removes inner whitespace and upper-cases, mirroring the database function. */
export function normalizeCollaborationCode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export const joinSchema = z
  .object({
    code: z.string().max(40).optional(),
    token: z
      .string()
      .regex(/^[0-9a-f]{32,128}$/)
      .optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.token), { message: "Enter a collaboration code." });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address.")
    .pipe(z.email("Enter a valid email address.")),
  role: z.enum(["EDITOR", "VIEWER"]),
});

export type InviteInput = z.infer<typeof inviteSchema>;

export const commentSchema = z
  .string()
  .trim()
  .min(1, "Write a comment first.")
  .max(2000, "Keep comments under 2,000 characters.");
