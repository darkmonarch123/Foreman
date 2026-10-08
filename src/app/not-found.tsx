import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <Wordmark className="text-lg" />
      <h1 className="font-display text-display">Nothing here</h1>
      <p className="max-w-md text-lg leading-relaxed text-muted">
        This page doesn’t exist, or you don’t have access to it. If someone sent you a link to a board, check that you
        are logged in with the account they invited.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <LinkButton href="/dashboard">Go to dashboard</LinkButton>
        <LinkButton href="/" variant="secondary">
          Foreman home
        </LinkButton>
      </div>
    </main>
  );
}
