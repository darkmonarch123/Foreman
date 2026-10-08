"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { loginAction } from "@/lib/auth/actions";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? undefined;
  const [formError, setFormError] = useState<{ message: string; unverified: boolean } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const result = await loginAction({ ...values, next });
    if (!result.ok) {
      setFormError({ message: result.message, unverified: result.code === "EMAIL_NOT_VERIFIED" });
      return;
    }
    // The server validated the destination as a same-origin path.
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {searchParams.get("reset") === "1" ? (
        <Notice tone="success">Your password has been changed. Log in with the new one.</Notice>
      ) : null}
      {searchParams.get("deleted") === "1" ? (
        <Notice tone="info">Your account has been scheduled for deletion and you have been signed out.</Notice>
      ) : null}
      {formError ? (
        <Notice tone="error">
          {formError.message}
          {formError.unverified ? (
            <>
              {" "}
              <Link href="/verify-email" className="font-medium underline underline-offset-2">
                Resend the verification email
              </Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <div className="flex flex-col gap-2">
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <Link
          href="/forgot-password"
          className="self-end text-[13px] text-muted underline underline-offset-2 hover:text-ink"
        >
          Forgot your password?
        </Link>
      </div>

      <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Logging in">
        Log in
      </Button>
    </form>
  );
}
