import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { SetupNotice } from "@/components/auth/setup-notice";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-display text-headline">Create your free workspace</h1>
      <p className="mb-8 mt-3 text-[15px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          Log in
        </Link>
      </p>
      <SetupNotice />
      <RegisterForm />
    </>
  );
}
