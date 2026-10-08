"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { forgotPasswordAction } from "@/lib/auth/actions";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    const result = await forgotPasswordAction(values);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return <Notice tone="success">If an account exists for this email, a password reset link has been sent.</Notice>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Sending link">
        Send reset link
      </Button>
    </form>
  );
}
