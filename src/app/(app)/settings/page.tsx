import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsView } from "@/components/app/settings-view";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Account settings" };

async function Settings() {
  const profile = await requireProfile("/settings");
  return <SettingsView profile={profile} />;
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-8 font-display text-headline">Account settings</h1>
      <Suspense
        fallback={
          <LoadingRegion label="Loading your settings">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="mt-8 h-64 rounded-card" />
          </LoadingRegion>
        }
      >
        <Settings />
      </Suspense>
    </div>
  );
}
