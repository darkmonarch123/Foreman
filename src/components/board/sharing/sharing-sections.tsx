"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Inbox, Mail, UserMinus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Avatar, personName } from "@/components/ui/avatar";
import { Pill, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Toggle } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import type { Invitation, InvitationStatus, Member, SharingServices, SharingSettings } from "@/lib/board/services";
import type { AccessMode } from "@/lib/board/types";
import { ACCESS_MODE_LABELS, ACCESS_MODES, inviteSchema, type InviteInput } from "@/lib/boards/schemas";
import { cn } from "@/lib/cn";
import { CopyField } from "./copy-field";
import { useAction, useLoader } from "./use-async";

type Services = SharingServices & { loadMembers(): Promise<Member[]> };

interface SectionProps {
  services: Services;
  /** Called after a change that other parts of the page may need to reflect. */
  onChanged?: () => void;
}

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="error">
      {message}{" "}
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
        Try again
      </button>
    </Notice>
  );
}

// -- Invite by email ---------------------------------------------------------

export function InviteSection({ services, onChanged }: SectionProps) {
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role: "EDITOR" } });

  async function onSubmit(values: InviteInput) {
    setFormError(null);
    setLink(null);
    try {
      const invitation = await services.createInvitation(values.email, values.role);
      setLink({ email: values.email, url: `${origin()}/invitations/accept?token=${invitation.token}` });
      reset({ email: "", role: values.role });
      onChanged?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The invitation couldn’t be created.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.com"
          wrapperClassName="flex-1"
          error={errors.email?.message}
          data-autofocus
          {...register("email")}
        />
        <Select label="Role" wrapperClassName="sm:w-36" {...register("role")}>
          <option value="EDITOR">Editor</option>
          <option value="VIEWER">Viewer</option>
        </Select>
        <Button type="submit" loading={isSubmitting} loadingLabel="Inviting" className="sm:mt-[26px]">
          <Mail className="size-4" aria-hidden />
          Invite
        </Button>
      </form>
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      {link ? (
        <div className="rounded-control border border-line bg-mint-tint p-4">
          <p className="text-sm">
            Invitation created for <span className="font-medium">{link.email}</span>. If they have a Foreman account
            with that address, it is waiting under their notifications. You can also send them this link. It is shown
            only once.
          </p>
          <div className="mt-3">
            <CopyField
              label="Invitation link"
              value={link.url}
              hint="Works only for that email address and expires in 7 days."
            />
          </div>
        </div>
      ) : (
        <p className="text-[13px] leading-snug text-muted">
          People are invited by email as an editor or viewer. The invitation only works for an account with that
          verified address.
        </p>
      )}
    </div>
  );
}

// -- Members ---------------------------------------------------------------

export function MembersSection({ services, onChanged, currentUserId }: SectionProps & { currentUserId: string }) {
  const members = useLoader(services.loadMembers);
  const action = useAction();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [transferring, setTransferring] = useState<Member | null>(null);

  const refresh = () => {
    members.reload();
    onChanged?.();
  };

  if (members.loading && !members.data) return <ListSkeleton />;
  if (members.error && !members.data) return <LoadError message={members.error} onRetry={members.reload} />;
  const list = members.data ?? [];
  const isOwner = list.some((member) => member.user_id === currentUserId && member.role === "OWNER");

  return (
    <div className="flex flex-col gap-3">
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}
      <ul className="divide-y divide-line rounded-control border border-line">
        {list.map((member) => {
          const self = member.user_id === currentUserId;
          return (
            <li key={member.user_id} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar person={member} decorative />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {personName(member)}
                  {self ? <span className="font-normal text-muted"> (you)</span> : null}
                </p>
                <p className="truncate text-[13px] text-muted">@{member.username}</p>
              </div>
              {isOwner && member.role !== "OWNER" ? (
                <div className="flex items-center gap-1.5">
                  <Select
                    label={`Role for ${personName(member)}`}
                    hideLabel
                    value={member.role}
                    disabled={action.pending}
                    onChange={(event) =>
                      action.run(
                        () => services.changeMemberRole(member.user_id, event.target.value as "EDITOR" | "VIEWER"),
                        refresh,
                      )
                    }
                    className="h-9 w-28 text-sm"
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </Select>
                  <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => setTransferring(member)}>
                    Make owner
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-error"
                    disabled={action.pending}
                    onClick={() => setRemoving(member)}
                    aria-label={`Remove ${personName(member)}`}
                  >
                    <UserMinus className="size-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              ) : (
                <RoleBadge role={member.role} />
              )}
            </li>
          );
        })}
      </ul>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${personName(removing)}?` : ""}
        description="They lose access to this board straight away. Their comments stay."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={action.pending}
              onClick={() =>
                removing &&
                action.run(
                  () => services.removeMember(removing.user_id),
                  () => {
                    setRemoving(null);
                    refresh();
                  },
                )
              }
            >
              Remove member
            </Button>
          </>
        }
      >
        {action.error ? <Notice tone="error">{action.error}</Notice> : null}
      </Modal>

      <Modal
        open={transferring !== null}
        onClose={() => setTransferring(null)}
        title={transferring ? `Make ${personName(transferring)} the owner?` : ""}
        description="They will control sharing, members and deletion. You become an editor and cannot undo this yourself."
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransferring(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={action.pending}
              onClick={() =>
                transferring &&
                action.run(
                  () => services.transferOwnership(transferring.user_id),
                  () => {
                    setTransferring(null);
                    refresh();
                  },
                )
              }
            >
              Transfer ownership
            </Button>
          </>
        }
      >
        {action.error ? <Notice tone="error">{action.error}</Notice> : null}
      </Modal>
    </div>
  );
}

// -- Invitations ------------------------------------------------------------

const STATUS_STYLE: Record<InvitationStatus, string> = {
  PENDING: "border-yellow bg-yellow-tint text-ink",
  ACCEPTED: "border-mint bg-mint-tint text-ink",
  DECLINED: "",
  EXPIRED: "",
  REVOKED: "border-coral bg-coral-tint text-ink",
};

const STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};

/** Remount with a new `key` to reload after an invitation is created elsewhere on the page. */
export function InvitationsSection({ services, onChanged }: SectionProps) {
  const invitations = useLoader<Invitation[]>(services.listInvitations);
  const action = useAction();
  const [renewed, setRenewed] = useState<{ email: string; url: string } | null>(null);

  if (invitations.loading && !invitations.data) return <ListSkeleton />;
  if (invitations.error && !invitations.data)
    return <LoadError message={invitations.error} onRetry={invitations.reload} />;
  const list = invitations.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Mail className="size-5" />}
        title="No invitations yet"
        description="Invitations you send appear here with their status."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}
      {renewed ? (
        <div className="rounded-control border border-line bg-mint-tint p-4">
          <CopyField
            label={`New invitation link for ${renewed.email}`}
            value={renewed.url}
            hint="The previous link no longer works. This one is shown only once."
          />
        </div>
      ) : null}
      <ul className="divide-y divide-line rounded-control border border-line">
        {list.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{invitation.invitee_email}</p>
              <p className="text-[13px] text-muted">
                {invitation.role === "EDITOR" ? "Editor" : "Viewer"}, sent <RelativeTime date={invitation.created_at} />
                {invitation.status === "PENDING" ? (
                  <>
                    , expires <RelativeTime date={invitation.expires_at} />
                  </>
                ) : null}
              </p>
            </div>
            <Pill className={STATUS_STYLE[invitation.status]}>{STATUS_LABEL[invitation.status]}</Pill>
            {invitation.status === "PENDING" || invitation.status === "EXPIRED" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={action.pending}
                onClick={() =>
                  action.run(
                    () => services.resendInvitation(invitation.id),
                    (result) => {
                      setRenewed({
                        email: invitation.invitee_email,
                        url: `${origin()}/invitations/accept?token=${result.token}`,
                      });
                      invitations.reload();
                    },
                  )
                }
              >
                Resend
              </Button>
            ) : null}
            {invitation.status === "PENDING" ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-error"
                disabled={action.pending}
                onClick={() =>
                  action.run(
                    () => services.revokeInvitation(invitation.id),
                    () => {
                      invitations.reload();
                      onChanged?.();
                    },
                  )
                }
              >
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// -- Join requests ----------------------------------------------------------

export function JoinRequestsSection({ services, onChanged }: SectionProps) {
  const requests = useLoader(services.listJoinRequests);
  const action = useAction();

  if (requests.loading && !requests.data) return <ListSkeleton />;
  if (requests.error && !requests.data) return <LoadError message={requests.error} onRetry={requests.reload} />;
  const list = requests.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Inbox className="size-5" />}
        title="No one is waiting"
        description="When someone asks to join with the link or code, their request appears here."
      />
    );
  }

  const decide = (id: string, approve: boolean, role?: "EDITOR" | "VIEWER") =>
    action.run(
      () => services.decideJoinRequest(id, approve, role),
      () => {
        requests.reload();
        onChanged?.();
      },
    );

  return (
    <div className="flex flex-col gap-3">
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}
      <ul className="divide-y divide-line rounded-control border border-line">
        {list.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-3 p-3">
            <Avatar person={request} decorative />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{personName(request)}</p>
              <p className="text-[13px] text-muted">
                @{request.username}, asked <RelativeTime date={request.created_at} />
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={action.pending} onClick={() => decide(request.id, true, "VIEWER")}>
                Approve as viewer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={action.pending}
                onClick={() => decide(request.id, true, "EDITOR")}
              >
                As editor
              </Button>
              <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => decide(request.id, false)}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -- Sharing mode, link and code ---------------------------------------------

export function SharingSection({ services, onChanged }: SectionProps) {
  const sharing = useLoader<SharingSettings>(services.getSharing);
  const action = useAction();
  const [freshLink, setFreshLink] = useState<string | null>(null);

  if (sharing.loading && !sharing.data) return <ListSkeleton />;
  if (sharing.error && !sharing.data) return <LoadError message={sharing.error} onRetry={sharing.reload} />;
  const settings = sharing.data;
  if (!settings) return null;

  const apply = (changes: Parameters<SharingServices["updateSharing"]>[0]) =>
    action.run(
      () => services.updateSharing(changes),
      (next) => {
        sharing.setData(next);
        onChanged?.();
      },
    );

  const linkModes = settings.access_mode === "LINK_VIEWER" || settings.access_mode === "LINK_REQUEST_ACCESS";

  return (
    <div className="flex flex-col gap-7">
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}

      <fieldset disabled={action.pending} className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-sm font-medium">Sharing mode</legend>
        {ACCESS_MODES.map((mode) => (
          <label
            key={mode}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-control border bg-surface p-3.5 transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
              settings.access_mode === mode ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="access-mode"
              className="mt-1 size-4 accent-black"
              checked={settings.access_mode === mode}
              onChange={() => apply({ access_mode: mode as AccessMode })}
            />
            <span>
              <span className="block text-sm font-medium">{ACCESS_MODE_LABELS[mode].label}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                {ACCESS_MODE_LABELS[mode].description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {!linkModes ? (
        <Notice tone="info">
          With this sharing mode the share link and collaboration code do nothing. Choose one of the “Anyone with the
          link” modes to use them.
        </Notice>
      ) : null}

      <section className="flex flex-col gap-4" aria-label="Collaboration code">
        <Toggle
          label="Collaboration code"
          description="A short code people can type at Join a board. It finds the board; the sharing mode decides what happens next."
          checked={settings.code_enabled}
          disabled={action.pending}
          onChange={(value) => apply({ code_enabled: value })}
        />
        {settings.code_enabled ? (
          <div className="flex flex-col gap-3">
            <CopyField label="Code" value={settings.collaboration_code} mono />
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => services.regenerateCode(),
                  (code) => {
                    sharing.setData({ ...settings, collaboration_code: code });
                    onChanged?.();
                  },
                )
              }
            >
              Regenerate code
            </Button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4" aria-label="Share link">
        <Toggle
          label="Share link"
          description="A private link to this board. Anyone using it must be signed in, and can never get more than view access from it."
          checked={settings.share_link_enabled}
          disabled={action.pending}
          onChange={(value) => {
            if (value && !settings.share_link_generated) {
              void action.run(
                () => services.regenerateShareLink(),
                (token) => {
                  setFreshLink(`${origin()}/join?token=${token}`);
                  sharing.setData({ ...settings, share_link_enabled: true, share_link_generated: true });
                  onChanged?.();
                },
              );
            } else {
              setFreshLink(null);
              void apply({ share_link_enabled: value });
            }
          }}
        />
        {freshLink ? (
          <CopyField
            label="Share link"
            value={freshLink}
            hint="Copy it now. For security the link is shown only once; regenerate it if you lose it."
          />
        ) : settings.share_link_enabled ? (
          <p className="text-[13px] leading-snug text-muted">
            A share link is active. It was shown when it was created and can’t be displayed again. Regenerate it to get
            a new one; the old link stops working.
          </p>
        ) : null}
        {settings.share_link_generated ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={action.pending}
            onClick={() =>
              action.run(
                () => services.regenerateShareLink(),
                (token) => {
                  setFreshLink(`${origin()}/join?token=${token}`);
                  sharing.setData({ ...settings, share_link_enabled: true, share_link_generated: true });
                  onChanged?.();
                },
              )
            }
          >
            Regenerate link
          </Button>
        ) : null}
      </section>

      <section aria-label="Viewer permissions">
        <Toggle
          label="Viewers can comment"
          description="Off by default. Viewers can never edit the canvas."
          checked={settings.viewers_can_comment}
          disabled={action.pending}
          onChange={(value) => apply({ viewers_can_comment: value })}
        />
      </section>
    </div>
  );
}
