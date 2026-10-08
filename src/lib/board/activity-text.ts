import { TYPE_LABELS } from "./defaults";
import type { ActivityItem } from "./services";
import type { CanvasObjectType } from "./types";

function objectNoun(metadata: Record<string, unknown>): string {
  const type = metadata.object_type;
  if (typeof type === "string" && type in TYPE_LABELS) {
    const label = TYPE_LABELS[type as CanvasObjectType].toLowerCase();
    return /^[aeiou]/.test(label) ? `an ${label}` : `a ${label}`;
  }
  return "an item";
}

function roleNoun(role: unknown): string {
  return role === "EDITOR" ? "an editor" : role === "VIEWER" ? "a viewer" : "a member";
}

function times(metadata: Record<string, unknown>): string {
  const repeat = typeof metadata.repeat === "number" ? metadata.repeat : 1;
  return repeat > 1 ? ` (${repeat} times)` : "";
}

/**
 * What happened, as a sentence fragment that follows the actor's name.
 * Only describes what the server recorded; unknown types get a neutral line.
 */
export function describeActivity(item: Pick<ActivityItem, "type" | "metadata" | "subject_name">): string {
  const { metadata } = item;
  const subject = item.subject_name ?? "a member";
  switch (item.type) {
    case "BOARD_CREATED":
      return metadata.duplicated ? "created this board as a copy" : "created this board";
    case "TEMPLATE_APPLIED":
      return typeof metadata.template === "string"
        ? `started from the ${metadata.template} template`
        : "applied a template";
    case "BOARD_RENAMED":
      return typeof metadata.title === "string" ? `renamed the board to “${metadata.title}”` : "renamed the board";
    case "BOARD_DELETED":
      return "moved the board to Trash";
    case "BOARD_RESTORED":
      return "restored the board";
    case "BOARD_DUPLICATED":
      return "duplicated the board";
    case "BOARD_EXPORTED":
      return "exported the board as a PNG";
    case "MEMBER_INVITED":
      return `invited someone as ${roleNoun(metadata.role)}`;
    case "INVITATION_ACCEPTED":
      return `joined as ${roleNoun(metadata.role)}`;
    case "INVITATION_DECLINED":
      return "declined an invitation";
    case "INVITATION_REVOKED":
      return "withdrew an invitation";
    case "MEMBER_JOINED":
      return `joined as ${roleNoun(metadata.role)}`;
    case "MEMBER_LEFT":
      return "left the board";
    case "MEMBER_REMOVED":
      return `removed ${subject}`;
    case "MEMBER_ROLE_CHANGED":
      return `made ${subject} ${roleNoun(metadata.role)}`;
    case "OWNERSHIP_TRANSFERRED":
      return `transferred ownership to ${subject}`;
    case "JOIN_REQUEST_CREATED":
      return "asked to join";
    case "JOIN_REQUEST_APPROVED":
      return `approved ${subject}’s request to join`;
    case "JOIN_REQUEST_REJECTED":
      return `rejected ${subject}’s request to join`;
    case "SHARING_UPDATED":
      return "changed the sharing settings";
    case "SHARE_LINK_ENABLED":
      return "turned on the share link";
    case "SHARE_LINK_DISABLED":
      return "turned off the share link";
    case "SHARE_LINK_REGENERATED":
      return "replaced the share link";
    case "COLLABORATION_CODE_REGENERATED":
      return "replaced the collaboration code";
    case "OBJECT_CREATED":
      return `added ${objectNoun(metadata)}`;
    case "OBJECT_UPDATED":
      return `edited ${objectNoun(metadata)}${times(metadata)}`;
    case "OBJECT_MOVED":
      return `moved ${objectNoun(metadata)}${times(metadata)}`;
    case "OBJECT_DELETED":
      return `deleted ${objectNoun(metadata)}`;
    case "OBJECT_RESTORED":
      return `restored ${objectNoun(metadata)}`;
    case "COMMENT_CREATED":
      return "commented";
    case "COMMENT_UPDATED":
      return "edited a comment";
    case "COMMENT_DELETED":
      return "deleted a comment";
    default:
      return "made a change";
  }
}

/** Activity that changes who is on the board or what they may do. */
export const MEMBERSHIP_ACTIVITY = new Set([
  "INVITATION_ACCEPTED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "MEMBER_REMOVED",
  "MEMBER_ROLE_CHANGED",
  "OWNERSHIP_TRANSFERRED",
  "JOIN_REQUEST_APPROVED",
]);

export const BOARD_SETTINGS_ACTIVITY = new Set(["BOARD_RENAMED", "SHARING_UPDATED", "BOARD_DELETED"]);

const CURSOR_COLORS = ["#2563EB", "#C0392B", "#268A57", "#B7791F", "#7C3AED", "#0E7490", "#BE185D", "#4D7C0F"];

/** A stable colour per person for their cursor. Always paired with their name. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
