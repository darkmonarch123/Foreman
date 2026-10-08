"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { registerAction } from "@/lib/auth/actions";
import { registerSchema, type RegisterInput } from "@/lib/auth/schemas";
import { cn } from "@/lib/cn";

const VERIFY_EMAIL_KEY = "foreman:verify-email";

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    defaultValues: { firstName: "", lastName: "", username: "", email: "", password: "", confirmPassword: "" },
  });
  const preference = useWatch({ control, name: "avatarPreference" });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    const result = await registerAction(values);
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields)) {
          setError(field as keyof RegisterInput, { message });
        }
      }
      if (!result.fields || result.code !== "VALIDATION_FAILED") setFormError(result.message);
      return;
    }
    try {
      // Only so the next screen can offer "resend" without asking again.
      window.sessionStorage.setItem(VERIFY_EMAIL_KEY, result.data.email);
    } catch {
      // Not essential.
    }
    router.push("/verify-email?sent=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          label="First name"
          autoComplete="given-name"
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <Input
          label="Last name"
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>
      <Input
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        hint="3–24 characters: lowercase letters, numbers and underscores."
        error={errors.username?.message}
        {...register("username")}
      />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <PasswordInput
        label="Password"
        autoComplete="new-password"
        hint="At least 10 characters, with a letter and a number."
        error={errors.password?.message}
        {...register("password")}
      />
      <PasswordInput
        label="Confirm password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <fieldset aria-describedby="avatar-preference-help" className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Initial avatar</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          {(["FEMALE", "MALE"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-control border bg-surface p-3 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                preference === value ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" value={value} className="sr-only" {...register("avatarPreference")} />
              {/* eslint-disable-next-line @next/next/no-img-element -- generated sample illustration */}
              <img
                src={`/api/avatar/${value.toLowerCase()}/samplepreview01`}
                alt=""
                className="size-10 rounded-full"
                width={40}
                height={40}
              />
              <span className="text-sm font-medium">{value === "FEMALE" ? "Female" : "Male"}</span>
            </label>
          ))}
        </div>
        <p id="avatar-preference-help" className="text-[13px] leading-snug text-muted">
          Your selection is used only to generate an initial avatar. You can change your avatar later.
        </p>
        {errors.avatarPreference ? (
          <p role="alert" className="text-[13px] text-error">
            {errors.avatarPreference.message}
          </p>
        ) : null}
      </fieldset>

      <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Creating account" className="mt-2">
        Create account
      </Button>

      <p className="text-[13px] leading-relaxed text-muted">
        By creating an account you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
          Terms
        </Link>{" "}
        and acknowledge the{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
          Privacy notice
        </Link>
        .
      </p>
    </form>
  );
}
