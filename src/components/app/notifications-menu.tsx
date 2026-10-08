"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import { acceptInvitationAction, decideJoinRequestAction, declineInvitationAction } from "@/lib/boards/actions";
import type { Notifications } from "@/lib/boards/types";

function splitName(name: string) {
  const [first, ...rest] = name.split(" ");
  return { first_name: first ?? "", last_name: rest.join(" ") };
}

/** Things waiting on the signed-in person: invitations to them and join requests on boards they own. */
export function NotificationsMenu({ notifications }: { notifications: Notifications }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = notifications.invitations.length + notifications.join_requests.length;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string, then?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        then?.();
        router.refresh();
      } else {
        toast.error(result.message ?? "That didn't work. Try again.");
      }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={count > 0 ? `Notifications, ${count} waiting` : "Notifications"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-ink/6"
      >
        <Bell className="size-[18px]" aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-medium text-white"
          >
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-12 z-40 w-[22rem] max-w-[calc(100vw-2rem)] animate-pop-in rounded-card border border-line bg-surface p-2 shadow-lift"
        >
          {count === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Nothing is waiting on you.</p>
          ) : (
            <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
              {notifications.invitations.map((invitation) => (
                <li key={invitation.id} className="rounded-control p-3 hover:bg-warm">
                  <div className="flex items-start gap-3">
                    <Avatar
                      person={{ ...splitName(invitation.inviter_name), avatar_url: invitation.inviter_avatar_url }}
                      decorative
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{invitation.inviter_name}</span> invited you to{" "}
                        <span className="font-medium">{invitation.board_title}</span> as{" "}
                        {invitation.role === "EDITOR" ? "an editor" : "a viewer"}.
                      </p>
                      <RelativeTime date={invitation.created_at} className="text-xs text-muted" />
                      <div className="mt-2.5 flex gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => acceptInvitationAction({ invitationId: invitation.id }),
                              `You joined ${invitation.board_title}.`,
                              () => {
                                setOpen(false);
                                router.push(`/boards/${invitation.board_id}`);
                              },
                            )
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() =>
                            run(() => declineInvitationAction({ invitationId: invitation.id }), "Invitation declined.")
                          }
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {notifications.join_requests.map((request) => (
                <li key={request.id} className="rounded-control p-3 hover:bg-warm">
                  <div className="flex items-start gap-3">
                    <Avatar
                      person={{ ...splitName(request.requester_name), avatar_url: request.requester_avatar_url }}
                      decorative
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{request.requester_name}</span> asked to join{" "}
                        <Link
                          href={`/boards/${request.board_id}/settings?tab=sharing`}
                          className="font-medium underline underline-offset-2"
                        >
                          {request.board_title}
                        </Link>
                        .
                      </p>
                      <RelativeTime date={request.created_at} className="text-xs text-muted" />
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => decideJoinRequestAction({ requestId: request.id, approve: true, role: "VIEWER" }),
                              `${request.requester_name} can now view the board.`,
                            )
                          }
                        >
                          Approve as viewer
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => decideJoinRequestAction({ requestId: request.id, approve: true, role: "EDITOR" }),
                              `${request.requester_name} can now edit the board.`,
                            )
                          }
                        >
                          As editor
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => decideJoinRequestAction({ requestId: request.id, approve: false }),
                              "Request rejected.",
                            )
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
