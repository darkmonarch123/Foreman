import { z } from "zod";
import { ASSISTANT_ACTIONS, MAX_GUIDANCE, MAX_PROPOSAL_TEXT, PROPOSAL_OBJECT_TYPES } from "./types";

/** Zod schemas for everything that crosses the Server Action boundary. */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color.");

export const proposalPropsSchema = z
  .object({
    text: z.string().max(MAX_PROPOSAL_TEXT, `Keep the text under ${MAX_PROPOSAL_TEXT} characters.`).optional(),
    fill: hexColor.optional(),
    stroke: hexColor.optional(),
    color: hexColor.optional(),
    strokeWidth: z.number().min(0).max(32).optional(),
    fontSize: z.number().min(8).max(200).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    bold: z.boolean().optional(),
  })
  .strict();

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

export const proposalDraftSchema = z
  .object({
    kind: z.literal("create_object"),
    object: z
      .object({
        type: z.enum(PROPOSAL_OBJECT_TYPES),
        x: coordinate,
        y: coordinate,
        width: z.number().finite().min(-5000).max(5000),
        height: z.number().finite().min(-5000).max(5000),
        props: proposalPropsSchema,
      })
      .strict(),
  })
  .strict();

export const analysisContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board") }).strict(),
  z.object({ kind: z.literal("object"), objectId: z.uuid() }).strict(),
]);

export const runAnalysisSchema = z
  .object({
    boardId: z.uuid(),
    action: z.enum(ASSISTANT_ACTIONS),
    context: analysisContextSchema,
    guidance: z.string().trim().max(MAX_GUIDANCE, `Keep guidance under ${MAX_GUIDANCE} characters.`).optional(),
  })
  .strict();

export const boardOnlySchema = z.object({ boardId: z.uuid() }).strict();
export const proposalIdSchema = z.object({ boardId: z.uuid(), proposalId: z.uuid() }).strict();
export const editProposalSchema = z
  .object({ boardId: z.uuid(), proposalId: z.uuid(), proposal: proposalDraftSchema })
  .strict();

export type RunAnalysisInput = z.infer<typeof runAnalysisSchema>;
