import type { BoardTransport } from "./engine";
import type { AccessMode, BoardRole, BoardSummary, ServerOperation } from "./types";

/**
 * Everything the board UI needs from the outside world, as interfaces.
 * The app provides a Supabase implementation (`supabase-services.ts`);
 * browser tests provide an in-memory one. The UI never imports Supabase.
 */

export interface Member {
  user_id: string;
  role: BoardRole;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string;
  joined_at: string;
}

export interface CommentAuthor {
  first_name: string;
  last_name: string;
  avatar_url: string;
}

export interface BoardComment {
  id: string;
  board_id: string;
  author_id: string | null;
  object_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: CommentAuthor | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  actor_id: string | null;
  object_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: CommentAuthor | null;
  subject_name: string | null;
}

export interface SharingSettings {
  board_id: string;
  access_mode: AccessMode;
  viewers_can_comment: boolean;
  collaboration_code: string;
  code_enabled: boolean;
  share_link_enabled: boolean;
  share_link_generated: boolean;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "REVOKED";

export interface Invitation {
  id: string;
  invitee_email: string;
  role: "EDITOR" | "VIEWER";
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
}

export interface JoinRequest {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string;
  status: "PENDING";
  created_at: string;
}

export interface CursorPosition {
  userId: string;
  x: number;
  y: number;
}

export type CommentEvent =
  { action: "created" | "updated"; comment: BoardComment } | { action: "deleted"; comment: { id: string } };

export interface ActivityEvent {
  id: string;
  type: string;
  actor_id: string | null;
  object_id: string | null;
  created_at: string;
}

export interface RealtimeHandlers {
  onOperation(operation: ServerOperation): void;
  onComment(event: CommentEvent): void;
  onActivity(event: ActivityEvent): void;
  /** User ids currently connected to the board. */
  onPresence(userIds: string[]): void;
  onCursor(cursor: CursorPosition): void;
  /** True when every channel is joined; false while connecting or after a drop. */
  onStatus(connected: boolean): void;
}

export interface BoardRealtime {
  connect(handlers: RealtimeHandlers): () => void;
  /** Ephemeral; never stored. Implementations throttle. */
  sendCursor(x: number, y: number): void;
}

export interface SharingServices {
  getSharing(): Promise<SharingSettings>;
  updateSharing(changes: {
    access_mode?: AccessMode;
    code_enabled?: boolean;
    share_link_enabled?: boolean;
    viewers_can_comment?: boolean;
  }): Promise<SharingSettings>;
  regenerateCode(): Promise<string>;
  /** Returns the raw link token once. */
  regenerateShareLink(): Promise<string>;
  createInvitation(
    email: string,
    role: "EDITOR" | "VIEWER",
  ): Promise<{ id: string; token: string; expires_at: string }>;
  listInvitations(): Promise<Invitation[]>;
  resendInvitation(id: string): Promise<{ id: string; token: string; expires_at: string }>;
  revokeInvitation(id: string): Promise<void>;
  listJoinRequests(): Promise<JoinRequest[]>;
  decideJoinRequest(id: string, approve: boolean, role?: "EDITOR" | "VIEWER"): Promise<void>;
  changeMemberRole(userId: string, role: "EDITOR" | "VIEWER"): Promise<void>;
  removeMember(userId: string): Promise<void>;
  transferOwnership(userId: string): Promise<void>;
}

export interface BoardServices extends SharingServices {
  transport: BoardTransport;
  realtime: BoardRealtime;
  getBoard(): Promise<BoardSummary>;
  loadMembers(): Promise<Member[]>;
  loadComments(before?: string): Promise<BoardComment[]>;
  addComment(body: string, objectId?: string | null): Promise<BoardComment>;
  updateComment(id: string, body: string): Promise<BoardComment>;
  deleteComment(id: string): Promise<void>;
  loadActivity(before?: string): Promise<ActivityItem[]>;
  renameBoard(title: string): Promise<BoardSummary>;
  recordExport(scope: "board" | "viewport"): Promise<void>;
}

export const COMMENTS_PAGE_SIZE = 50;
export const ACTIVITY_PAGE_SIZE = 30;
