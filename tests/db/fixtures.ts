import { expect } from "vitest";
import type { CanvasObject, SubmitResult } from "@/lib/board/types";
import { RpcError, type TestDatabase, type TestUser, uuid } from "./harness";

export interface BoardFixture {
  owner: TestUser;
  editor: TestUser;
  viewer: TestUser;
  outsider: TestUser;
  boardId: string;
  code: string;
}

/** Asserts that a call is rejected with the given Foreman error code. */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected rejection with ${code}`).toBeInstanceOf(RpcError);
  expect((caught as RpcError).message).toContain(code);
}

/**
 * Asserts that a call RETURNS the given status. join_board and
 * accept_invitation report their outcomes this way instead of raising, so
 * that failed attempts stay on the caller's rate-limit counter.
 */
export async function expectStatus(promise: Promise<unknown>, status: string): Promise<void> {
  const result = (await promise) as { status?: string } | null;
  expect(result?.status, `expected status ${status}`).toBe(status);
}

/** Asserts that a call is rejected by a privilege or RLS check (not by application logic). */
export async function expectDenied(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database to deny this").toBeInstanceOf(RpcError);
  expect((caught as RpcError).message).toMatch(/permission denied|row-level security/i);
}

export async function invite(
  db: TestDatabase,
  owner: TestUser,
  boardId: string,
  invitee: TestUser,
  role: "EDITOR" | "VIEWER",
): Promise<void> {
  const invitation = await db.rpc<{ id: string; token: string }>(owner, "create_invitation", {
    p_board_id: boardId,
    p_email: invitee.email,
    p_role: role,
  });
  await expectStatus(db.rpc(invitee, "accept_invitation", { p_invitation_id: invitation.id }), "ACCEPTED");
}

/** A board with an owner, an editor and a viewer who joined through real invitations, plus an outsider. */
export async function createBoardFixture(
  db: TestDatabase,
  options: { template?: string; title?: string } = {},
): Promise<BoardFixture> {
  const [owner, editor, viewer, outsider] = await Promise.all([
    db.createUser(),
    db.createUser(),
    db.createUser(),
    db.createUser(),
  ]);
  const board = await db.rpc<{ id: string; collaboration_code: string }>(owner, "create_board", {
    p_title: options.title ?? "Fixture board",
    p_template_slug: options.template ?? null,
  });
  await invite(db, owner, board.id, editor, "EDITOR");
  await invite(db, owner, board.id, viewer, "VIEWER");
  return { owner, editor, viewer, outsider, boardId: board.id, code: board.collaboration_code };
}

export async function createNote(
  db: TestDatabase,
  user: TestUser,
  boardId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ result: SubmitResult; objectId: string; operationId: string }> {
  const objectId = uuid();
  const operationId = uuid();
  const result = await db.rpc<SubmitResult>(user, "submit_operation", {
    p_board_id: boardId,
    p_operation_id: operationId,
    p_type: "OBJECT_CREATED",
    p_object_id: objectId,
    p_payload: {
      type: "STICKY_NOTE",
      x: 10,
      y: 20,
      width: 160,
      height: 120,
      props: { text: "A note", fill: "#F8DD72" },
      ...overrides,
    },
  });
  return { result, objectId, operationId };
}

export function submit(
  db: TestDatabase,
  user: TestUser,
  boardId: string,
  type: string,
  objectId: string,
  payload: Record<string, unknown> = {},
  expectedVersion: number | null = null,
  operationId: string = uuid(),
): Promise<SubmitResult> {
  return db.rpc<SubmitResult>(user, "submit_operation", {
    p_board_id: boardId,
    p_operation_id: operationId,
    p_type: type,
    p_object_id: objectId,
    p_payload: payload,
    p_expected_version: expectedVersion,
  });
}

export type { CanvasObject };
