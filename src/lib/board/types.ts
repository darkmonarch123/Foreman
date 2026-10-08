/**
 * Shared canvas types. These mirror the JSON produced by the database
 * functions `private.object_state` and `private.operation_json`.
 */

export const OBJECT_TYPES = ["STICKY_NOTE", "TEXT", "RECTANGLE", "CIRCLE", "ARROW", "DRAWING"] as const;

export type CanvasObjectType = (typeof OBJECT_TYPES)[number];

export const OPERATION_TYPES = [
  "OBJECT_CREATED",
  "OBJECT_UPDATED",
  "OBJECT_MOVED",
  "OBJECT_DELETED",
  "OBJECT_RESTORED",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export type TextAlign = "left" | "center" | "right";

/** Whitelisted style/content keys. Anything else is dropped by the server. */
export interface CanvasProps {
  text?: string;
  fill?: string;
  stroke?: string;
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
  textAlign?: TextAlign;
  bold?: boolean;
  /** DRAWING only: flat [x0, y0, x1, y1, ...] relative to the object origin. */
  points?: number[];
}

export interface CanvasObject {
  id: string;
  type: CanvasObjectType;
  x: number;
  y: number;
  /** For ARROW, width/height are the delta from start to end and may be negative. */
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  props: CanvasProps;
  version: number;
  deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

export type AccessMode = "PRIVATE" | "INVITE_ONLY" | "LINK_VIEWER" | "LINK_REQUEST_ACCESS";

/** An operation the server accepted and assigned a sequence number to. */
export interface ServerOperation {
  operation_id: string;
  sequence: number;
  type: OperationType;
  object_id: string;
  actor_id: string | null;
  object: CanvasObject;
  server_timestamp: string;
}

export interface CreatePayload {
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z_index?: number;
  props: CanvasProps;
}

export interface UpdatePayload {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  z_index?: number;
  props?: CanvasProps;
}

export interface MovePayload {
  x: number;
  y: number;
}

export type OperationPayload = CreatePayload | UpdatePayload | MovePayload | Record<string, never>;

/** A locally-created operation that the server has not acknowledged yet. */
export interface PendingOperation {
  operation_id: string;
  type: OperationType;
  object_id: string;
  payload: OperationPayload;
  /** Version of the object this operation was based on (text conflict check). */
  expected_version: number | null;
  client_timestamp: string;
}

export type SubmitResult =
  | { status: "accepted" | "duplicate"; sequence: number; object: CanvasObject; last_sequence: number }
  | { status: "conflict"; code: string; object: CanvasObject; last_sequence: number };

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  access_mode: AccessMode;
  viewers_can_comment: boolean;
  owner_id: string;
  last_sequence: number;
  created_at: string;
  updated_at: string;
  role: BoardRole;
}

export interface BoardState {
  board: BoardSummary;
  snapshot: { sequence: number; objects: CanvasObject[] };
  operations: ServerOperation[];
  last_sequence: number;
}
