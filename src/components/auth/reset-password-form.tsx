"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, LinkButton } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { resetPasswordAction } from "@/lib/auth/actions";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/auth/schemas";

export function ResetPasswordForm() {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    const result = await resetPasswordAction(values);
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields)) {
          setError(field as keyof ResetPasswordInput, { message });
        }
      } else {
        setFormError(result.message);
      }
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Notice tone="success">Your password has been changed and every device has been signed out.</Notice>
        <LinkButton href="/login?reset=1" size="lg">
          Log in
        </LinkButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <PasswordInput
        label="New password"
        autoComplete="new-password"
        hint="At least 10 characters, with a letter and a number."
        error={errors.password?.message}
        {...register("password")}
      />
      <PasswordInput
        label="Confirm new password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Saving password">
        Save new password
      </Button>
    </form>
  );
}
