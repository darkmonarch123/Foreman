import { Search } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/ui/wordmark";
import { requireProfile } from "@/lib/auth/dal";
import { getNotifications } from "@/lib/boards/data";
import type { Notifications } from "@/lib/boards/types";
import { NotificationsMenu } from "./notifications-menu";
import { ProfileMenu } from "./profile-menu";
import { SidebarNav, SidebarNavFallback } from "./sidebar-nav";

function SearchForm() {
  return (
    <form action="/dashboard" method="get" role="search" className="relative w-full max-w-md">
      <label htmlFor="board-search" className="sr-only">
        Search boards
      </label>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        id="board-search"
        name="q"
        type="search"
        placeholder="Search boards"
        maxLength={120}
        className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm placeholder:text-muted/70 hover:border-line-strong focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/20"
      />
    </form>
  );
}

async function ShellNotifications() {
  let notifications: Notifications = { invitations: [], join_requests: [] };
  try {
    notifications = await getNotifications();
  } catch {
    // The bell is not worth failing the page for; it shows as empty.
  }
  return <NotificationsMenu notifications={notifications} />;
}

async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface/60 p-4 lg:flex">
        <Link href="/dashboard" className="px-3 py-3 text-lg" aria-label="Foreman dashboard">
          <Wordmark />
        </Link>
        <nav aria-label="Workspace" className="mt-6 flex-1">
          <Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav />
          </Suspense>
        </nav>
        <ProfileMenu profile={profile} showName side="top" align="start" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-warm/90 px-4 backdrop-blur sm:px-8">
          <Link href="/dashboard" className="mr-2 text-base lg:hidden" aria-label="Foreman dashboard">
            <Wordmark />
          </Link>
          <SearchForm />
          <div className="ml-auto flex items-center gap-1">
            <Suspense fallback={<Skeleton className="size-10 rounded-full" />}>
              <ShellNotifications />
            </Suspense>
            <div className="lg:hidden">
              <ProfileMenu profile={profile} />
            </div>
          </div>
        </header>
        <nav aria-label="Workspace" className="border-b border-line px-2 py-2 lg:hidden">
          <Suspense fallback={<SidebarNavFallback orientation="horizontal" />}>
            <SidebarNav orientation="horizontal" />
          </Suspense>
        </nav>
        {!profile.email_verified ? (
          <div className="px-4 pt-4 sm:px-8">
            <Notice tone="warning">
              Verify your email address to create boards and collaborate.{" "}
              <Link href="/verify-email" className="font-medium underline underline-offset-2">
                Send a new verification link
              </Link>
            </Notice>
          </div>
        ) : null}
        <main id="main" className="flex-1 px-4 py-8 sm:px-8 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" role="status" aria-label="Loading your workspace">
      <div className="hidden w-64 shrink-0 border-r border-line p-4 lg:block">
        <Skeleton className="mx-3 my-3 h-6 w-32" />
        <div className="mt-6 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-16 items-center border-b border-line px-8">
          <Skeleton className="h-10 w-full max-w-md rounded-full" />
        </div>
        <div className="p-8">
          <Skeleton className="h-10 w-64" />
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-56 rounded-card" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The signed-in frame: sidebar, search, notifications. Children render only for an active session. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
