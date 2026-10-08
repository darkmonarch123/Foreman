import type { AvatarPerson } from "@/components/ui/avatar";
import type { PreviewObject } from "@/components/board/board-preview";
import type { AccessMode, BoardRole, CanvasObjectType } from "@/lib/board/types";
import type { PlanId, TemplateCategory } from "@/lib/templates/catalog";

export type BoardScope = "all" | "mine" | "shared" | "trash";

export interface BoardListItem {
  id: string;
  title: string;
  description: string;
  access_mode: AccessMode;
  owner_id: string;
  role: BoardRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  member_count: number;
  members: (AvatarPerson & { user_id: string })[];
  preview: {
    type: CanvasObjectType;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string | null;
    stroke: string | null;
  }[];
}

export interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  min_plan: PlanId;
  is_featured: boolean;
  sort_order: number;
  content: PreviewObject[];
}

export interface PendingInvitation {
  id: string;
  board_id: string;
  board_title: string;
  role: "EDITOR" | "VIEWER";
  inviter_name: string;
  inviter_avatar_url: string;
  expires_at: string;
  created_at: string;
}

export interface PendingJoinRequest {
  id: string;
  board_id: string;
  board_title: string;
  requester_name: string;
  requester_avatar_url: string;
  created_at: string;
}

export interface Notifications {
  invitations: PendingInvitation[];
  join_requests: PendingJoinRequest[];
}

export type JoinStatus =
  | "UNAVAILABLE"
  | "REQUEST_SUBMITTED"
  | "JOINED_VIEWER"
  | "ALREADY_MEMBER"
  | "PENDING_APPROVAL"
  | "ACCESS_DENIED"
  | "RATE_LIMITED";

export interface JoinResult {
  status: JoinStatus;
  board_id?: string;
}
