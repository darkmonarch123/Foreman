"use client";

import { MailOpen, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { acceptInvitationAction } from "@/lib/boards/actions";

export function AcceptInvitation() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const validToken = token && /^[0-9a-f]{32,128}$/.test(token) ? token : null;
  const [error, setError] = useState<string | null>(validToken ? null : "This invitation isn’t available.");
  const [pending, startTransition] = useTransition();

  function accept() {
    if (!validToken) return;
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction({ token: validToken });
      if (!result.ok) {
        // Expired, revoked, already accepted and unavailable each have their own message.
        setError(result.message);
        return;
      }
      router.replace(`/boards/${result.data.board_id}`);
    });
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-4" role="alert">
        <span className="flex size-12 items-center justify-center rounded-full bg-coral-tint text-error" aria-hidden>
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="font-display text-headline">This invitation can’t be used</h1>
        <p className="text-[15px] leading-relaxed text-muted">{error}</p>
        <p className="text-[15px] leading-relaxed text-muted">
          Invitations only work for the email address they were sent to. Make sure you are logged in with that address.
        </p>
        <LinkButton href="/dashboard" variant="secondary">
          Go to dashboard
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <span className="flex size-12 items-center justify-center rounded-full bg-sky-tint" aria-hidden>
        <MailOpen className="size-6" />
      </span>
      <h1 className="font-display text-headline">You’ve been invited to a board</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        Accepting adds the board to your dashboard with the role its owner chose for you.
      </p>
      <Button size="lg" loading={pending} loadingLabel="Accepting" onClick={accept}>
        Accept invitation
      </Button>
    </div>
  );
}
