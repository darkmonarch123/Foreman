"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Download, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, PasswordInput, Toggle } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  changePasswordAction,
  deleteAccountAction,
  logoutEverywhereAction,
  regenerateAvatarAction,
  updateNotificationPrefsAction,
  updateProfileAction,
} from "@/lib/auth/actions";
import {
  changePasswordSchema,
  DELETE_CONFIRMATION,
  deleteAccountSchema,
  profileSchema,
  type ChangePasswordInput,
  type DeleteAccountInput,
  type ProfileInput,
} from "@/lib/auth/schemas";
import type { Profile } from "@/lib/auth/types";
import { cn } from "@/lib/cn";
import { PLANS, formatCapacity } from "@/lib/templates/plans";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "privacy", label: "Privacy and data" },
  { id: "notifications", label: "Notifications" },
  { id: "sessions", label: "Sessions" },
];

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      {description ? <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ProfileTab({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [avatarPending, startAvatar] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: profile.first_name, lastName: profile.last_name, username: profile.username },
  });

  async function onSubmit(values: ProfileInput) {
    setFormError(null);
    const result = await updateProfileAction(values);
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields))
          setError(field as keyof ProfileInput, { message });
      } else {
        setFormError(result.message);
      }
      return;
    }
    toast.success("Profile saved.");
    router.refresh();
  }

  function regenerate(preference?: "MALE" | "FEMALE") {
    startAvatar(async () => {
      const result = await regenerateAvatarAction(preference ? { preference } : undefined);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Avatar updated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title="Avatar" description="A generated illustration, not a likeness. Regenerate it as often as you like.">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar person={profile} size="xl" />
          <div className="flex flex-col gap-4">
            <Button variant="secondary" loading={avatarPending} onClick={() => regenerate()} className="self-start">
              <RefreshCw className="size-4" aria-hidden />
              Regenerate avatar
            </Button>
            <fieldset disabled={avatarPending}>
              <legend className="text-sm font-medium">Initial avatar preference</legend>
              <div className="mt-2 flex gap-2">
                {(["FEMALE", "MALE"] as const).map((value) => {
                  const active = profile.avatar_gender_selection === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => (active ? undefined : regenerate(value))}
                      className={cn(
                        "h-9 rounded-full border px-4 text-sm transition-colors",
                        active ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      {value === "FEMALE" ? "Female" : "Male"}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 max-w-sm text-[13px] leading-snug text-muted">
                Used only to choose the style of your generated avatar.
              </p>
            </fieldset>
          </div>
        </div>
      </Card>

      <Card title="Your details">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-w-xl flex-col gap-5">
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
            autoCapitalize="none"
            spellCheck={false}
            hint="Lowercase letters, numbers and underscores."
            error={errors.username?.message}
            {...register("username")}
          />
          <Input
            label="Email"
            value={profile.email}
            readOnly
            disabled
            hint={profile.email_verified ? "Verified." : "Not verified yet."}
          />
          <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="self-start">
            Save changes
          </Button>
        </form>
      </Card>

      <Card title="Plan">
        <p className="text-sm leading-relaxed">
          You are on the <span className="font-medium">{PLANS[profile.plan].name}</span> plan, with template access up
          to {formatCapacity(PLANS[profile.plan].templateCapacity)} templates as the library grows.
        </p>
        <p className="mt-2 text-[13px] text-muted">Paid plans can’t be purchased yet.</p>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onTouched",
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ChangePasswordInput) {
    setFormError(null);
    const result = await changePasswordAction(values);
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields))
          setError(field as keyof ChangePasswordInput, { message });
      } else {
        setFormError(result.message);
      }
      return;
    }
    reset();
    toast.success("Password changed. Your other devices have been signed out.");
  }

  return (
    <Card
      title="Change password"
      description="You’ll need your current password. Changing it signs out every other device."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-w-md flex-col gap-5">
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register("currentPassword")}
        />
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
        <Button type="submit" loading={isSubmitting} loadingLabel="Changing password" className="self-start">
          Change password
        </Button>
      </form>
    </Card>
  );
}

function PrivacyTab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "", confirmation: "" as typeof DELETE_CONFIRMATION },
  });

  async function onSubmit(values: DeleteAccountInput) {
    setFormError(null);
    const result = await deleteAccountAction(values);
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields))
          setError(field as keyof DeleteAccountInput, { message });
      } else {
        setFormError(result.message);
      }
      return;
    }
    router.replace("/login?deleted=1");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Download your data"
        description="A JSON file with your profile, the boards you can access and their content, the comments you wrote, and recent activity on your boards."
      >
        <a href="/api/account/export" download className={buttonClasses("secondary", "md")}>
          <Download className="size-4" aria-hidden />
          Download data export
        </a>
        <p className="mt-3 text-[13px] text-muted">Limited to five exports an hour.</p>
      </Card>

      <Card
        title="Delete account"
        description="Your account is deactivated straight away and you are signed out everywhere. Boards only you are on move to deletion with it. Boards you own that other people are on must be transferred or emptied first."
      >
        <Button
          variant="danger"
          onClick={() => {
            reset();
            setFormError(null);
            setOpen(true);
          }}
        >
          Delete my account
        </Button>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="This cannot be undone from inside the product."
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="delete-account" variant="danger" loading={isSubmitting} loadingLabel="Deleting">
              Delete my account
            </Button>
          </>
        }
      >
        <form id="delete-account" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <PasswordInput
            label="Your password"
            autoComplete="current-password"
            error={errors.password?.message}
            data-autofocus
            {...register("password")}
          />
          <Input
            label={`Type ${DELETE_CONFIRMATION} to confirm`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            error={errors.confirmation?.message}
            {...register("confirmation")}
          />
        </form>
      </Modal>
    </div>
  );
}

const PREFERENCES = [
  { key: "invitations", label: "Board invitations", description: "When someone invites you to a board." },
  { key: "join_requests", label: "Join requests", description: "When someone asks to join a board you own." },
  { key: "comments", label: "Comments", description: "When someone comments on a board you are on." },
  { key: "product_updates", label: "Product updates", description: "Occasional news about Foreman." },
] as const;

function NotificationsTab({ profile }: { profile: Profile }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    invitations: true,
    join_requests: true,
    comments: true,
    product_updates: false,
    ...profile.notification_prefs,
  });
  const [pending, startTransition] = useTransition();

  function change(key: string, value: boolean) {
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    startTransition(async () => {
      const result = await updateNotificationPrefsAction({ [key]: value });
      if (!result.ok) {
        setPrefs(previous);
        toast.error(result.message);
      }
    });
  }

  return (
    <Card title="Email notifications" description="Choose what you would like to hear about.">
      <Notice tone="info" className="mb-6">
        Email delivery isn’t switched on for this deployment yet. Your choices are saved and will apply when it is.
        Invitations and join requests always appear under the bell at the top of the page.
      </Notice>
      <div className="flex max-w-xl flex-col gap-5">
        {PREFERENCES.map((preference) => (
          <Toggle
            key={preference.key}
            label={preference.label}
            description={preference.description}
            checked={prefs[preference.key] === true}
            disabled={pending}
            onChange={(value) => change(preference.key, value)}
          />
        ))}
      </div>
    </Card>
  );
}

function SessionsTab() {
  const [pending, startTransition] = useTransition();
  return (
    <Card
      title="Sessions"
      description="You are signed in on this device. Foreman can’t list your other devices individually, but you can sign all of them out at once."
    >
      <Button
        variant="secondary"
        loading={pending}
        loadingLabel="Signing out"
        onClick={() => startTransition(() => logoutEverywhereAction())}
      >
        Sign out of all sessions
      </Button>
      <p className="mt-3 text-[13px] text-muted">This includes the device you are using now.</p>
    </Card>
  );
}

export function SettingsView({ profile }: { profile: Profile }) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((entry) => entry.id === requested) ? (requested as string) : "profile";

  return (
    <Tabs
      label="Account settings"
      tabs={TABS}
      value={tab}
      onChange={(id) => router.replace(id === "profile" ? "/settings" : `/settings?tab=${id}`, { scroll: false })}
      panelClassName="pt-8"
    >
      {tab === "profile" ? <ProfileTab profile={profile} /> : null}
      {tab === "security" ? <SecurityTab /> : null}
      {tab === "privacy" ? <PrivacyTab /> : null}
      {tab === "notifications" ? <NotificationsTab profile={profile} /> : null}
      {tab === "sessions" ? <SessionsTab /> : null}
    </Tabs>
  );
}
