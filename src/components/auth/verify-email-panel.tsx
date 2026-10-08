"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { resendVerificationAction, verifyEmailAction } from "@/lib/auth/actions";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { safeNextPath } from "@/lib/routes";

const VERIFY_EMAIL_KEY = "foreman:verify-email";

function ResendForm() {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  useEffect(() => {
    try {
      const remembered = window.sessionStorage.getItem(VERIFY_EMAIL_KEY);
      if (remembered) setValue("email", remembered);
    } catch {
      // Not essential.
    }
  }, [setValue]);

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    const result = await resendVerificationAction(values);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Notice tone="success">If that address has an account waiting to be verified, a new link is on its way.</Notice>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" variant="secondary" loading={isSubmitting} loadingLabel="Sending">
        Resend verification email
      </Button>
    </form>
  );
}

type State = "verifying" | "verified" | "invalid" | "sent" | "idle";

export function VerifyEmailPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const status = params.get("status");
  const next = safeNextPath(params.get("next"), "/welcome");
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  const state: State = failed
    ? "invalid"
    : tokenHash
      ? "verifying"
      : status === "verified"
        ? "verified"
        : status === "invalid"
          ? "invalid"
          : params.get("sent") === "1"
            ? "sent"
            : "idle";

  useEffect(() => {
    if (!tokenHash || started.current) return;
    started.current = true;
    void verifyEmailAction({ tokenHash, type: type ?? "email" }).then((result) => {
      if (result.ok) {
        // Replace the URL so the token is not kept in history.
        router.replace("/verify-email?status=verified");
        router.refresh();
      } else {
        setFailed(true);
        router.replace("/verify-email?status=invalid");
      }
    });
  }, [tokenHash, type, router]);

  if (state === "verifying") {
    return (
      <div role="status" className="flex flex-col items-start gap-4">
        <Spinner className="size-8" />
        <h1 className="font-display text-headline">Verifying your email</h1>
        <p className="text-[15px] text-muted">This only takes a moment.</p>
      </div>
    );
  }

  if (state === "verified") {
    return (
      <div className="flex flex-col items-start gap-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-mint-tint text-success" aria-hidden>
          <ShieldCheck className="size-6" />
        </span>
        <h1 className="font-display text-headline">Email verified</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Your address is confirmed. You can now create boards and collaborate.
        </p>
        <LinkButton href={next} size="lg" className="mt-2">
          Continue
        </LinkButton>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="flex flex-col gap-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-coral-tint text-error" aria-hidden>
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="font-display text-headline">That link didn’t work</h1>
        <p className="mb-2 text-[15px] leading-relaxed text-muted">
          The verification link is invalid or has expired. Links can be used once. Request a new one below.
        </p>
        <ResendForm />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="flex size-12 items-center justify-center rounded-full bg-sky-tint text-ink" aria-hidden>
        <MailCheck className="size-6" />
      </span>
      <h1 className="font-display text-headline">{state === "sent" ? "Check your inbox" : "Verify your email"}</h1>
      <p className="mb-2 text-[15px] leading-relaxed text-muted">
        {state === "sent"
          ? "If the details you entered can be used for a new account, we’ve sent a verification link. Open it on this device to finish setting up."
          : "Your email address must be verified before you can create boards or collaborate. Enter it to get a new link."}
      </p>
      <ResendForm />
      <p className="mt-4 text-[15px]">
        <Link href="/login" className="font-medium underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
