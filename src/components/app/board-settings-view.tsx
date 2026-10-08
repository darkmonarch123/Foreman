"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  InvitationsSection,
  InviteSection,
  JoinRequestsSection,
  MembersSection,
  SharingSection,
} from "@/components/board/sharing/sharing-sections";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { createSupabaseBoardServices } from "@/lib/board/supabase-services";
import type { BoardSummary } from "@/lib/board/types";
import { deleteBoardAction, duplicateBoardAction, updateBoardAction } from "@/lib/boards/actions";
import { boardTitleSchema } from "@/lib/boards/schemas";
import { getBrowserClient } from "@/lib/supabase/client";

const TABS = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "sharing", label: "Sharing" },
  { id: "danger", label: "Danger zone" },
];

const generalSchema = z.object({
  title: boardTitleSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters."),
});
type GeneralInput = z.infer<typeof generalSchema>;

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      {description ? <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function GeneralTab({ board }: { board: BoardSummary }) {
  const router = useRouter();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<GeneralInput>({
    resolver: zodResolver(generalSchema),
    defaultValues: { title: board.title, description: board.description },
  });

  async function onSubmit(values: GeneralInput) {
    setFormError(null);
    const result = await updateBoardAction({ boardId: board.id, ...values });
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields))
          setError(field as keyof GeneralInput, { message });
      } else {
        setFormError(result.message);
      }
      return;
    }
    reset(values);
    toast.success("Board details saved.");
    router.refresh();
  }

  return (
    <Card title="Board details">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-w-xl flex-col gap-5">
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Input label="Board name" maxLength={120} error={errors.title?.message} {...register("title")} />
        <Textarea
          label="Description"
          rows={4}
          maxLength={500}
          error={errors.description?.message}
          {...register("description")}
        />
        <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="self-start">
          Save changes
        </Button>
      </form>
    </Card>
  );
}

function DangerTab({ board }: { board: BoardSummary }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Duplicate board"
        description="Makes a private copy of the canvas that you own. Members, comments and history are not copied."
      >
        <Button
          variant="secondary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await duplicateBoardAction({ boardId: board.id });
              if (!result.ok) {
                toast.error(result.message);
                return;
              }
              toast.success("Board duplicated.");
              router.push(`/boards/${result.data.id}`);
            })
          }
        >
          Duplicate board
        </Button>
      </Card>

      <Card
        title="Delete board"
        description="Removes the board for everyone on it and moves it to your Trash. From Trash you can restore it or delete it forever, which cannot be undone."
      >
        <Button
          variant="danger"
          onClick={() => {
            setTyped("");
            setError(null);
            setOpen(true);
          }}
        >
          Delete this board
        </Button>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this board?"
        description="Everyone on the board loses access immediately."
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={typed.trim() !== board.title.trim()}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteBoardAction({ boardId: board.id });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  toast.success("Board moved to Trash.");
                  router.replace("/dashboard?view=trash");
                })
              }
            >
              Delete board
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Input
            label={`Type the board name to confirm: ${board.title}`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            data-autofocus
          />
        </div>
      </Modal>
    </div>
  );
}

export function BoardSettingsView({ board, currentUserId }: { board: BoardSummary; currentUserId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((entry) => entry.id === requested) ? (requested as string) : "general";
  const [invitationsKey, setInvitationsKey] = useState(0);
  const services = useMemo(
    () => createSupabaseBoardServices(getBrowserClient(), board.id, currentUserId),
    [board.id, currentUserId],
  );
  const refresh = () => router.refresh();

  return (
    <>
      <Link
        href={`/boards/${board.id}`}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to board
      </Link>
      <h1 className="font-display text-headline">Board settings</h1>
      <p className="mb-8 mt-2 text-[15px] text-muted">{board.title}</p>

      <Tabs
        label="Board settings"
        tabs={TABS}
        value={tab}
        onChange={(id) =>
          router.replace(id === "general" ? `/boards/${board.id}/settings` : `/boards/${board.id}/settings?tab=${id}`, {
            scroll: false,
          })
        }
        panelClassName="pt-8"
      >
        {tab === "general" ? <GeneralTab board={board} /> : null}
        {tab === "members" ? (
          <Card title="Members" description="Only you, as the owner, can change roles or remove people.">
            <MembersSection services={services} currentUserId={currentUserId} onChanged={refresh} />
          </Card>
        ) : null}
        {tab === "invitations" ? (
          <div className="flex flex-col gap-6">
            <Card title="Invite someone">
              <InviteSection services={services} onChanged={() => setInvitationsKey((value) => value + 1)} />
            </Card>
            <Card
              title="Invitations"
              description="Pending invitations expire after seven days. Resending replaces the link."
            >
              <InvitationsSection key={invitationsKey} services={services} />
            </Card>
          </div>
        ) : null}
        {tab === "sharing" ? (
          <div className="flex flex-col gap-6">
            <Card
              title="Requests to join"
              description="People who used your link or code and are waiting for a decision."
            >
              <JoinRequestsSection services={services} onChanged={refresh} />
            </Card>
            <Card title="Sharing">
              <SharingSection services={services} onChanged={refresh} />
            </Card>
          </div>
        ) : null}
        {tab === "danger" ? <DangerTab board={board} /> : null}
      </Tabs>
    </>
  );
}
