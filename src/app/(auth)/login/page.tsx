import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { SetupNotice } from "@/components/auth/setup-notice";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="font-display text-headline">Welcome back</h1>
      <p className="mb-8 mt-3 text-[15px] text-muted">
        New to Foreman?{" "}
        <Link href="/register" className="font-medium text-ink underline underline-offset-4">
          Create an account
        </Link>
      </p>
      <SetupNotice />
      <Suspense
        fallback={
          <div className="flex flex-col gap-5" aria-hidden>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-12 rounded-full" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </>
  );
}
