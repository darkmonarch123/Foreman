import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { RECOVERY_COOKIE } from "@/lib/auth/constants";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

/** True only for a browser that has just followed a valid recovery link. */
async function hasRecoverySession(): Promise<boolean> {
  const cookieStore = await cookies();
  if (!getPublicEnv()) return false;
  const marker = cookieStore.get(RECOVERY_COOKIE)?.value;
  if (!marker) return false;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub === marker;
}

async function ResetGate() {
  if (await hasRecoverySession()) {
    return <ResetPasswordForm />;
  }
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="error">This reset link is invalid or has expired. Request a new one to continue.</Notice>
      <LinkButton href="/forgot-password" size="lg">
        Request a new link
      </LinkButton>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="font-display text-headline">Choose a new password</h1>
      <p className="mb-8 mt-3 text-[15px] leading-relaxed text-muted">
        Saving a new password signs you out everywhere, including this device.
      </p>
      <Suspense
        fallback={
          <div className="flex flex-col gap-5" role="status" aria-label="Checking your reset link">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-12 rounded-full" />
          </div>
        }
      >
        <ResetGate />
      </Suspense>
    </>
  );
}
