import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  ActivityItem,
  BoardComment,
  Invitation,
  JoinRequest,
  Member,
  SharingSettings,
} from "@/lib/board/services";
import type { BoardRole, BoardSummary, PendingOperation } from "@/lib/board/types";
import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";
import { FakeBoardServer } from "../support/fake-board-server";

/**
 * TEST ONLY. An in-memory backend that implements the BoardServices contract
 * over HTTP + Server-Sent Events, so the real board UI and sync engine can be
 * driven in a real browser by several "users" at once without Supabase.
 *
 * It follows the same rules as the database functions (roles, sequencing,
 * conflicts) but it is not Supabase: Supabase Auth, RLS and Realtime are
 * covered by tests/db and by the e2e suite that needs a real project.
 */

const BOARD_ID = "00000000-0000-4000-8000-0000000000b1";

const PEOPLE: Record<string, Member> = {
  ada: member("00000000-0000-4000-8000-00000000000a", "OWNER", "Ada", "Okafor", "ada", "female", "seedadaaaa000001"),
  ben: member("00000000-0000-4000-8000-00000000000b", "EDITOR", "Ben", "Mensah", "ben", "male", "seedbennnn000002"),
  vic: member("00000000-0000-4000-8000-00000000000c", "VIEWER", "Vic", "Adeyemi", "vic", "female", "seedviccc0000003"),
};

function member(
  id: string,
  role: BoardRole,
  first: string,
  last: string,
  username: string,
  style: string,
  seed: string,
): Member {
  return {
    user_id: id,
    role,
    first_name: first,
    last_name: last,
    username,
    avatar_url: `/api/avatar/${style}/${seed}`,
    joined_at: new Date(0).toISOString(),
  };
}

class HttpError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

interface Client {
  key: string;
  response: ServerResponse;
}

export class FakeBackend {
  private server: Server | null = null;
  private board = new FakeBoardServer();
  private members = new Map<string, Member>();
  private comments: BoardComment[] = [];
  private activity: ActivityItem[] = [];
  private invitations: Invitation[] = [];
  private requests: JoinRequest[] = [];
  private sharing!: SharingSettings;
  private title = "Foreman Launch Plan";
  private clients = new Set<Client>();
  private failNext: { code: ErrorCode; times: number } | null = null;
  private dropOperationEvents = false;
  private counter = 0;
  port = 0;

  constructor() {
    this.reset();
  }

  reset(options: { template?: boolean } = {}): void {
    for (const client of this.clients) client.response.end();
    this.clients.clear();
    this.board = new FakeBoardServer();
    this.members = new Map(Object.entries(PEOPLE).map(([key, value]) => [key, { ...value }]));
    this.comments = [];
    this.activity = [];
    this.invitations = [];
    this.requests = [];
    this.title = "Foreman Launch Plan";
    this.failNext = null;
    this.dropOperationEvents = false;
    this.sharing = {
      board_id: BOARD_ID,
      access_mode: "INVITE_ONLY",
      viewers_can_comment: false,
      collaboration_code: "F-2WE-23XX",
      code_enabled: true,
      share_link_enabled: false,
      share_link_generated: false,
    };
    if (options.template) {
      const roadmap = TEMPLATE_CATALOG.find((template) => template.slug === "project-roadmap")!;
      roadmap.content.forEach((object, index) => {
        const id = this.uuid();
        this.board.objects.set(id, {
          id,
          ...object,
          rotation: 0,
          z_index: index + 1,
          version: 1,
          deleted: false,
          created_by: PEOPLE.ada.user_id,
          updated_by: PEOPLE.ada.user_id,
          updated_at: new Date(0).toISOString(),
        });
      });
    }
    this.log("ada", "BOARD_CREATED");
  }

  private uuid(): string {
    this.counter += 1;
    return `00000000-0000-4000-9000-${this.counter.toString(16).padStart(12, "0")}`;
  }

  private log(actorKey: string, type: string, extra: Partial<ActivityItem> = {}): void {
    const actor = this.members.get(actorKey) ?? PEOPLE[actorKey];
    const item: ActivityItem = {
      id: this.uuid(),
      type,
      actor_id: actor.user_id,
      object_id: null,
      metadata: {},
      created_at: new Date().toISOString(),
      actor: { first_name: actor.first_name, last_name: actor.last_name, avatar_url: actor.avatar_url },
      subject_name: null,
      ...extra,
    };
    this.activity.unshift(item);
    this.emit("activity", {
      id: item.id,
      type,
      actor_id: item.actor_id,
      object_id: item.object_id,
      created_at: item.created_at,
    });
  }

  private emit(event: string, data: unknown, exceptKey?: string): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (client.key !== exceptKey) client.response.write(frame);
    }
  }

  private emitPresence(): void {
    const ids = [...new Set([...this.clients].map((client) => this.members.get(client.key)?.user_id).filter(Boolean))];
    this.emit("presence", ids);
  }

  private summary(key: string): BoardSummary {
    const me = this.members.get(key);
    if (!me) throw new HttpError("BOARD_NOT_FOUND");
    return {
      id: BOARD_ID,
      title: this.title,
      description: "",
      access_mode: this.sharing.access_mode,
      viewers_can_comment: this.sharing.viewers_can_comment,
      owner_id: PEOPLE.ada.user_id,
      last_sequence: this.board.lastSequence,
      created_at: new Date(0).toISOString(),
      updated_at: new Date().toISOString(),
      role: me.role,
    };
  }

  private requireRole(key: string, roles: BoardRole[]): Member {
    const me = this.members.get(key);
    if (!me) throw new HttpError("BOARD_NOT_FOUND");
    if (!roles.includes(me.role)) throw new HttpError("BOARD_ACCESS_DENIED");
    return me;
  }

  private handle(key: string, fn: string, args: Record<string, unknown>): unknown {
    if (this.failNext && this.failNext.times > 0 && fn === "submit") {
      this.failNext.times -= 1;
      throw new HttpError(this.failNext.code);
    }
    const anyRole: BoardRole[] = ["OWNER", "EDITOR", "VIEWER"];
    switch (fn) {
      case "state":
        this.requireRole(key, anyRole);
        return { ...this.board.state(), board: this.summary(key) };
      case "submit": {
        const me = this.requireRole(key, ["OWNER", "EDITOR"]);
        const operation = args.operation as PendingOperation;
        const before = this.board.lastSequence;
        const result = this.board.apply(me.user_id, operation);
        if (this.board.lastSequence > before) {
          const accepted = this.board.log[this.board.log.length - 1];
          if (!this.dropOperationEvents) this.emit("operation", accepted);
          this.log(key, operation.type, {
            object_id: operation.object_id,
            metadata: { object_type: accepted.object.type },
          });
        }
        return result;
      }
      case "fetchAfter":
        this.requireRole(key, anyRole);
        return {
          operations: this.board.log.filter((operation) => operation.sequence > Number(args.sequence)),
          last_sequence: this.board.lastSequence,
        };
      case "getBoard":
        return this.summary(key);
      case "loadMembers":
        this.requireRole(key, anyRole);
        return [...this.members.values()];
      case "loadComments":
        this.requireRole(key, anyRole);
        return this.comments;
      case "addComment": {
        const me = this.requireRole(key, anyRole);
        if (me.role === "VIEWER" && !this.sharing.viewers_can_comment) throw new HttpError("COMMENTING_DISABLED");
        const body = String(args.body ?? "").trim();
        if (!body) throw new HttpError("VALIDATION_FAILED");
        const comment: BoardComment = {
          id: this.uuid(),
          board_id: BOARD_ID,
          author_id: me.user_id,
          object_id: (args.objectId as string | null) ?? null,
          body,
          created_at: new Date().toISOString(),
          edited_at: null,
          author: { first_name: me.first_name, last_name: me.last_name, avatar_url: me.avatar_url },
        };
        this.comments.unshift(comment);
        this.emit("comment", { action: "created", comment });
        this.log(key, "COMMENT_CREATED", { object_id: comment.object_id });
        return comment;
      }
      case "updateComment": {
        const me = this.requireRole(key, anyRole);
        const comment = this.comments.find((entry) => entry.id === args.id && entry.author_id === me.user_id);
        if (!comment) throw new HttpError("COMMENT_NOT_FOUND");
        comment.body = String(args.body).trim();
        comment.edited_at = new Date().toISOString();
        this.emit("comment", { action: "updated", comment });
        this.log(key, "COMMENT_UPDATED");
        return comment;
      }
      case "deleteComment": {
        const me = this.requireRole(key, anyRole);
        const index = this.comments.findIndex((entry) => entry.id === args.id && entry.author_id === me.user_id);
        if (index < 0) throw new HttpError("COMMENT_NOT_FOUND");
        const [removed] = this.comments.splice(index, 1);
        this.emit("comment", { action: "deleted", comment: { id: removed.id } });
        this.log(key, "COMMENT_DELETED");
        return null;
      }
      case "loadActivity":
        this.requireRole(key, anyRole);
        return this.activity.slice(0, 30);
      case "renameBoard":
        this.requireRole(key, ["OWNER"]);
        this.title = String(args.title).trim();
        this.log(key, "BOARD_RENAMED", { metadata: { title: this.title } });
        return this.summary(key);
      case "recordExport":
        this.requireRole(key, anyRole);
        this.log(key, "BOARD_EXPORTED", { metadata: { format: "png", scope: args.scope } });
        return null;
      case "getSharing":
        this.requireRole(key, ["OWNER"]);
        return this.sharing;
      case "updateSharing": {
        this.requireRole(key, ["OWNER"]);
        const changes = args.changes as Partial<SharingSettings>;
        this.sharing = {
          ...this.sharing,
          ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
        };
        this.log(key, "SHARING_UPDATED");
        return this.sharing;
      }
      case "regenerateCode":
        this.requireRole(key, ["OWNER"]);
        this.sharing = { ...this.sharing, collaboration_code: "F-9ZZ-88YY" };
        return this.sharing.collaboration_code;
      case "regenerateShareLink":
        this.requireRole(key, ["OWNER"]);
        this.sharing = { ...this.sharing, share_link_enabled: true, share_link_generated: true };
        return "a".repeat(64);
      case "createInvitation": {
        this.requireRole(key, ["OWNER"]);
        const invitation: Invitation = {
          id: this.uuid(),
          invitee_email: String(args.email),
          role: args.role as "EDITOR" | "VIEWER",
          status: "PENDING",
          expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          created_at: new Date().toISOString(),
          responded_at: null,
        };
        this.invitations.unshift(invitation);
        this.log(key, "MEMBER_INVITED", { metadata: { role: invitation.role } });
        return { id: invitation.id, token: "b".repeat(64), expires_at: invitation.expires_at };
      }
      case "listInvitations":
        this.requireRole(key, ["OWNER"]);
        return this.invitations;
      case "resendInvitation":
        this.requireRole(key, ["OWNER"]);
        return { id: args.id, token: "c".repeat(64), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() };
      case "revokeInvitation": {
        this.requireRole(key, ["OWNER"]);
        const invitation = this.invitations.find((entry) => entry.id === args.id);
        if (invitation) invitation.status = "REVOKED";
        this.log(key, "INVITATION_REVOKED");
        return null;
      }
      case "listJoinRequests":
        this.requireRole(key, ["OWNER"]);
        return this.requests;
      case "decideJoinRequest":
        this.requireRole(key, ["OWNER"]);
        this.requests = this.requests.filter((entry) => entry.id !== args.id);
        return null;
      case "changeMemberRole": {
        this.requireRole(key, ["OWNER"]);
        const target = [...this.members.values()].find((entry) => entry.user_id === args.userId);
        if (!target || target.role === "OWNER") throw new HttpError("MEMBER_NOT_FOUND");
        target.role = args.role as BoardRole;
        this.log(key, "MEMBER_ROLE_CHANGED", {
          metadata: { role: target.role },
          subject_name: `${target.first_name} ${target.last_name}`,
        });
        return null;
      }
      case "removeMember": {
        this.requireRole(key, ["OWNER"]);
        const entry = [...this.members.entries()].find(([, value]) => value.user_id === args.userId);
        if (!entry || entry[1].role === "OWNER") throw new HttpError("MEMBER_NOT_FOUND");
        this.log(key, "MEMBER_REMOVED", { subject_name: `${entry[1].first_name} ${entry[1].last_name}` });
        this.members.delete(entry[0]);
        return null;
      }
      case "transferOwnership":
        throw new HttpError("UNKNOWN");
      default:
        throw new HttpError("UNKNOWN");
    }
  }

  /** Controls used by tests to simulate failures and missed events. */
  private control(action: string, body: Record<string, unknown>): unknown {
    switch (action) {
      case "reset":
        this.reset({ template: body.template === true });
        return null;
      case "fail-next":
        this.failNext = { code: body.code as ErrorCode, times: Number(body.times ?? 1) };
        return null;
      case "drop-operation-events":
        this.dropOperationEvents = body.drop === true;
        return null;
      case "state":
        return {
          objects: [...this.board.objects.values()],
          lastSequence: this.board.lastSequence,
          log: this.board.log.map((operation) => ({
            type: operation.type,
            actor_id: operation.actor_id,
            sequence: operation.sequence,
          })),
          activity: this.activity.map((item) => item.type),
          comments: this.comments.map((comment) => comment.body),
          submitCalls: this.board.submitCalls.length,
        };
      default:
        throw new HttpError("UNKNOWN");
    }
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  async start(): Promise<number> {
    this.server = createServer(async (request, response) => {
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      };
      if (request.method === "OPTIONS") {
        response.writeHead(204, cors).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const key = url.searchParams.get("user") ?? "";

      if (url.pathname === "/events") {
        response.writeHead(200, {
          ...cors,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        response.write("retry: 300\n\n");
        if (!this.members.has(key)) {
          response.end();
          return;
        }
        const client: Client = { key, response };
        this.clients.add(client);
        response.write("event: ready\ndata: {}\n\n");
        this.emitPresence();
        request.on("close", () => {
          this.clients.delete(client);
          this.emitPresence();
        });
        return;
      }

      try {
        const body = await this.readBody(request);
        let result: unknown;
        if (url.pathname.startsWith("/__test/")) {
          result = this.control(url.pathname.slice("/__test/".length), body);
        } else if (url.pathname === "/cursor") {
          const me = this.members.get(key);
          if (me) this.emit("cursor", { user_id: me.user_id, x: body.x, y: body.y }, key);
          result = null;
        } else if (url.pathname.startsWith("/rpc/")) {
          result = this.handle(key, url.pathname.slice("/rpc/".length), body);
        } else {
          throw new HttpError("UNKNOWN");
        }
        response.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(result ?? null));
      } catch (error) {
        const code: ErrorCode = error instanceof HttpError ? error.code : "UNKNOWN";
        response
          .writeHead(ERROR_CATALOG[code].status, { ...cors, "Content-Type": "application/json" })
          .end(JSON.stringify({ code }));
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.response.end();
    this.clients.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

export const FAKE_PEOPLE = PEOPLE;
export const FAKE_BOARD_ID = BOARD_ID;
