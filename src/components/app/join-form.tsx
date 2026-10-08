"use client";

import { CircleCheck, Clock, Eye, Hourglass, ShieldX, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { joinBoardAction } from "@/lib/boards/actions";
import { normalizeCollaborationCode } from "@/lib/boards/schemas";
import type { JoinResult } from "@/lib/boards/types";

interface Outcome {
  icon: ReactNode;
  tone: string;
  title: string;
  body: string;
}

const OUTCOMES: Record<JoinResult["status"], Outcome> = {
  UNAVAILABLE: {
    icon: <TriangleAlert className="size-6" />,
    tone: "bg-coral-tint text-error",
    title: "Board not found or access is unavailable.",
    body: "Check the code with the person who shared it. Codes look like F-1WE-23XX.",
  },
  REQUEST_SUBMITTED: {
    icon: <Hourglass className="size-6" />,
    tone: "bg-yellow-tint text-warning",
    title: "Request submitted",
    body: "The board’s owner has been asked to let you in. The board will appear on your dashboard once they approve.",
  },
  JOINED_VIEWER: {
    icon: <Eye className="size-6" />,
    tone: "bg-mint-tint text-success",
    title: "You joined as a viewer",
    body: "You can look around and follow along. The owner can make you an editor.",
  },
  ALREADY_MEMBER: {
    icon: <CircleCheck className="size-6" />,
    tone: "bg-mint-tint text-success",
    title: "You’re already on this board",
    body: "Nothing changed. Open it to carry on.",
  },
  PENDING_APPROVAL: {
    icon: <Clock className="size-6" />,
    tone: "bg-yellow-tint text-warning",
    title: "Your request is waiting for approval",
    body: "You have already asked to join this board. The owner hasn’t decided yet.",
  },
  ACCESS_DENIED: {
    icon: <ShieldX className="size-6" />,
    tone: "bg-coral-tint text-error",
    title: "Access denied",
    body: "The owner declined your request to join this board.",
  },
  RATE_LIMITED: {
    icon: <Clock className="size-6" />,
    tone: "bg-yellow-tint text-warning",
    title: "Too many attempts",
    body: "Wait a few minutes before trying another code.",
  },
};

export function JoinForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const validToken = token && /^[0-9a-f]{32,128}$/.test(token) ? token : null;
  const [code, setCode] = useState(() => normalizeCollaborationCode(params.get("code") ?? ""));
  const [result, setResult] = useState<JoinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(input: { code: string } | { token: string }) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const response = await joinBoardAction(input);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResult(response.data);
    });
  }

  const outcome = result ? OUTCOMES[result.status] : null;

  return (
    <div className="flex flex-col gap-8">
      {validToken ? (
        <div className="rounded-card border border-line bg-surface p-6">
          <p className="font-display text-2xl tracking-tight">You’ve been sent a board link</p>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Depending on how the owner set it up, you will either join as a viewer or send a request to join.
          </p>
          <Button className="mt-5" size="lg" loading={pending} onClick={() => submit({ token: validToken })}>
            Continue
          </Button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit({ code });
          }}
          className="flex flex-col gap-4"
        >
          <Input
            label="Collaboration code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onBlur={() => setCode((value) => normalizeCollaborationCode(value))}
            placeholder="F-1WE-23XX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            className="font-mono tracking-[0.18em]"
            hint="Ask the board’s owner for the code. Capitals and spaces don’t matter."
            data-autofocus
          />
          <Button
            type="submit"
            size="lg"
            loading={pending}
            loadingLabel="Checking code"
            disabled={code.trim().length === 0}
            className="self-start"
          >
            Join board
          </Button>
        </form>
      )}

      <div aria-live="polite">
        {error ? (
          <div className="flex items-start gap-4 rounded-card border border-line bg-surface p-6">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-coral-tint text-error"
              aria-hidden
            >
              <TriangleAlert className="size-6" />
            </span>
            <div>
              <p className="font-display text-xl tracking-tight">That didn’t work</p>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{error}</p>
            </div>
          </div>
        ) : null}
        {outcome ? (
          <div className="flex items-start gap-4 rounded-card border border-line bg-surface p-6">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-full ${outcome.tone}`}
              aria-hidden
            >
              {outcome.icon}
            </span>
            <div>
              <p className="font-display text-xl tracking-tight">{outcome.title}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{outcome.body}</p>
              {result?.board_id ? (
                <LinkButton href={`/boards/${result.board_id}`} className="mt-4">
                  Open board
                </LinkButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
