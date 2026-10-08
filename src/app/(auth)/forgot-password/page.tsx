import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { SetupNotice } from "@/components/auth/setup-notice";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-display text-headline">Reset your password</h1>
      <p className="mb-8 mt-3 text-[15px] leading-relaxed text-muted">
        Enter the email you signed up with and we’ll send a link to choose a new password.
      </p>
      <SetupNotice />
      <ForgotPasswordForm />
      <p className="mt-8 text-[15px]">
        <Link href="/login" className="font-medium underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </>
  );
}
