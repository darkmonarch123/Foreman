"use client";

import { TriangleAlert } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";

interface ErrorPanelProps {
  /** Next.js supplies a digest that matches the server log entry. It is safe to show. */
  digest?: string;
  onRetry: () => void;
  homeHref?: string;
}

/** Generic failure screen. Never shows a stack trace or the error message itself. */
export function ErrorPanel({ digest, onRetry, homeHref = "/dashboard" }: ErrorPanelProps) {
  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-coral-tint text-error" aria-hidden>
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="font-display text-headline">Something went wrong</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        The page couldn’t be shown. Your saved work is not affected. Try again, and if it keeps happening, come back in
        a few minutes.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>Try again</Button>
        <LinkButton href={homeHref} variant="secondary">
          Go to dashboard
        </LinkButton>
      </div>
      {digest ? <p className="text-xs text-muted">Reference: {digest}</p> : null}
    </div>
  );
}
