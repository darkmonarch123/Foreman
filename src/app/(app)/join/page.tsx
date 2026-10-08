import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinForm } from "@/components/app/join-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Join a board",
  // A share-link token may be in the URL: never pass it on as a referrer.
  referrer: "no-referrer",
};

export default function JoinPage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-headline">Join a board</h1>
      <p className="mb-8 mt-2 text-[15px] leading-relaxed text-muted">
        Enter a collaboration code to find a board. What happens next depends on how its owner has set up sharing.
      </p>
      <Suspense fallback={<Skeleton className="h-40 rounded-card" />}>
        <JoinForm />
      </Suspense>
    </div>
  );
}
