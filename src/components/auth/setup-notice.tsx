import { Notice } from "@/components/ui/notice";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Shown on account pages when the deployment has no Supabase project
 * configured, so the reason nothing works is stated plainly.
 */
export function SetupNotice() {
  if (isSupabaseConfigured()) return null;
  return (
    <Notice tone="warning" className="mb-6">
      <p className="font-medium">Foreman isn’t connected to its database yet.</p>
      <p className="mt-1">
        Accounts are unavailable until <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set for this deployment. See the README for setup steps.
      </p>
    </Notice>
  );
}
