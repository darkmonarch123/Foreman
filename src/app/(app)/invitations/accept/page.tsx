import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvitation } from "@/components/app/accept-invitation";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Board invitation", referrer: "no-referrer" };

export default function AcceptInvitationPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Suspense fallback={<Skeleton className="h-48 rounded-card" />}>
        <AcceptInvitation />
      </Suspense>
    </div>
  );
}
