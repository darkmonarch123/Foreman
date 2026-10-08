import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

/**
 * One screen for "does not exist", "was deleted" and "you are not a member",
 * so the page never confirms that a private board exists.
 */
export function BoardUnavailable({ message }: { message?: string }) {
  return (
    <main id="main" className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-yellow-tint" aria-hidden>
        <SearchX className="size-6" />
      </span>
      <h1 className="font-display text-headline">Board not found or access is unavailable.</h1>
      <p className="max-w-md text-[15px] leading-relaxed text-muted">
        {message ??
          "The link may be wrong, the board may have been deleted, or you may not have been added to it. If someone invited you, check that you are logged in with the email address they used."}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <LinkButton href="/dashboard">Go to dashboard</LinkButton>
        <LinkButton href="/join" variant="secondary">
          Join with a code
        </LinkButton>
      </div>
    </main>
  );
}
