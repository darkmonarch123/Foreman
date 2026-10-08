import { TriangleAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

/** A server-rendered failure screen with a safe, human-readable message. */
export function ErrorPanel({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <main
      id="main"
      role="alert"
      className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-coral-tint text-error" aria-hidden>
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="font-display text-headline">This couldn’t be loaded</h1>
      <p className="max-w-md text-[15px] leading-relaxed text-muted">{message}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <LinkButton href={retryHref}>Try again</LinkButton>
        <LinkButton href="/dashboard" variant="secondary">
          Go to dashboard
        </LinkButton>
      </div>
    </main>
  );
}
