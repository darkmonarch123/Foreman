import type { Metadata } from "next";
import Link from "next/link";
import { LegalHeader } from "@/components/marketing/legal-header";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <LegalHeader title="Privacy" summary="What Foreman stores about you, why, and what you can do about it." />

      <h2>What Foreman stores</h2>
      <ul>
        <li>Account details you enter: first name, last name, username, email address.</li>
        <li>Your password, handled only by Supabase Auth. Foreman’s own code never stores, logs or returns it.</li>
        <li>An initial avatar preference (male or female) and a random seed, used only to draw a generated avatar.</li>
        <li>Boards you create or join, the items on them, and the comments you write.</li>
        <li>An activity record of actions on boards, such as creating an item or changing a member’s role.</li>
        <li>Security events, such as failed attempts to look up a collaboration code.</li>
        <li>Your cookie choice, with the time you made it and the policy version.</li>
      </ul>

      <h2>What Foreman does not do</h2>
      <ul>
        <li>It does not include analytics, advertising or tracking scripts.</li>
        <li>It does not send your email address or name to an avatar service. Avatars are drawn by Foreman itself.</li>
        <li>
          It does not show your email address to other people on a board. They see your name, username and avatar.
        </li>
        <li>It does not record cursor positions or presence. Those are live signals and are never stored.</li>
      </ul>

      <h2>Who can see your content</h2>
      <p>
        A board is visible only to its members. Access is enforced in the database for every read and write, not just in
        the interface. A collaboration code or share link never grants more than view access, and only when the board’s
        owner has chosen a sharing mode that allows it.
      </p>

      <h2>Where it is stored</h2>
      <p>
        Data is stored in the Supabase project configured for this deployment (PostgreSQL, authentication and realtime
        messaging) and the application is served from Render. The operator of the deployment chooses the regions.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Download your data as a JSON file from{" "}
          <Link href="/settings?tab=privacy">Account settings, Privacy and data</Link>.
        </li>
        <li>Change your name, username and avatar at any time.</li>
        <li>
          Delete your account from the same page. Deletion deactivates the account and signs you out everywhere
          immediately. Final removal of the stored record is carried out by the operator; the retention period is theirs
          to set and state here.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        Foreman uses essential cookies only. See the <Link href="/cookies">Cookie Policy</Link>.
      </p>
    </>
  );
}
