import Link from "next/link";
import type { ReactNode } from "react";
import { BoardPreview } from "@/components/board/board-preview";
import { planning } from "@/components/marketing/vignettes";
import { Wordmark } from "@/components/ui/wordmark";

/** Shared frame for the sign-in and account-recovery pages. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="self-start text-lg" aria-label="Foreman home">
          <Wordmark />
        </Link>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          {children}
        </main>
        <p className="text-[13px] text-muted">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
            Privacy
          </Link>
          <span aria-hidden> · </span>
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
            Terms
          </Link>
          <span aria-hidden> · </span>
          <Link href="/cookies" className="underline underline-offset-2 hover:text-ink">
            Cookies
          </Link>
        </p>
      </div>
      <aside className="hidden bg-sky-tint p-12 lg:flex lg:flex-col lg:justify-between" aria-hidden>
        <p className="font-display max-w-sm text-title">Plan visually. Build together.</p>
        <div className="rounded-card bg-surface/80 p-8 shadow-soft">
          <BoardPreview objects={planning} padding={16} />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-ink/60">
          Boards, notes and diagrams on one canvas, shared in real time with the people you invite.
        </p>
      </aside>
    </div>
  );
}
