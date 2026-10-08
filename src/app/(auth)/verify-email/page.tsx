import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupNotice } from "@/components/auth/setup-notice";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Verify your email",
  // The URL can carry a one-time token: never send it anywhere as a referrer.
  referrer: "no-referrer",
};

export default function VerifyEmailPage() {
  return (
    <>
      <SetupNotice />
      <Suspense
        fallback={
          <div className="flex flex-col gap-4" aria-hidden>
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-5" />
          </div>
        }
      >
        <VerifyEmailPanel />
      </Suspense>
    </>
  );
}
