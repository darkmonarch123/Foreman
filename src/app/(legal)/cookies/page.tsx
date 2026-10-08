import type { Metadata } from "next";
import { LegalHeader } from "@/components/marketing/legal-header";
import { ManageCookiesButton } from "@/components/marketing/manage-cookies-button";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <>
      <LegalHeader title="Cookie Policy" summary="Foreman sets essential cookies only. Here is each one." />

      <h2>Essential cookies</h2>
      <p>These are required for the product to work and cannot be switched off.</p>
      <ul>
        <li>
          <strong>Session cookies</strong> (names beginning <code>sb-</code>): keep you signed in. Set by Supabase Auth,
          sent only over HTTPS in production, and limited to this site.
        </li>
        <li>
          <strong>fm_recovery</strong>: set for fifteen minutes after you open a password-reset link, so only that
          browser can choose the new password. Not readable by scripts.
        </li>
      </ul>

      <h2>Browser storage</h2>
      <ul>
        <li>Your cookie choice, so the banner does not reappear.</li>
        <li>
          Board edits that have not reached the server yet, so they are not lost if your connection drops. They are
          removed as soon as the server confirms them.
        </li>
        <li>
          The email address you just registered with, for the length of the tab, to prefill “resend verification”.
        </li>
      </ul>

      <h2>Optional cookies</h2>
      <p>
        There are none today: no analytics, no advertising, no cross-site tracking. The preferences below exist so that
        if an optional category is ever added, it stays off until you turn it on. Nothing optional is loaded before you
        consent.
      </p>
      <p>
        <ManageCookiesButton />
      </p>
    </>
  );
}
