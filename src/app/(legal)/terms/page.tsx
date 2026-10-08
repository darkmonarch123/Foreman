import type { Metadata } from "next";
import Link from "next/link";
import { LegalHeader } from "@/components/marketing/legal-header";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <>
      <LegalHeader title="Terms" summary="The ground rules for using Foreman." />

      <h2>Your account</h2>
      <ul>
        <li>
          Register with accurate details and an email address you control. You must verify it before collaborating.
        </li>
        <li>Keep your password to yourself. You are responsible for what happens under your account.</li>
        <li>One person per account. Do not create accounts to impersonate someone else.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        What you put on a board remains yours. You decide who can see it through invitations and sharing settings. Do
        not add content you have no right to share, or content that is unlawful or abusive.
      </p>

      <h2>Sharing and roles</h2>
      <ul>
        <li>The owner of a board controls its members, its sharing mode and its deletion.</li>
        <li>Editors can change the canvas and comment. Viewers can look, and comment only if the owner allows it.</li>
        <li>If you are removed from a board you lose access to it, including to comments you wrote there.</li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not attempt to access boards you have not been given access to, or to guess collaboration codes.</li>
        <li>
          Do not overload the service. Automated limits apply to actions such as creating boards and joining by code.
        </li>
        <li>Do not interfere with other people’s use of the service.</li>
      </ul>

      <h2>Plans</h2>
      <p>
        Foreman is currently free to use. The Plus and Pro plans on the <Link href="/#pricing">pricing section</Link>{" "}
        describe planned capabilities and cannot be purchased. Template numbers shown for each plan are capacity limits,
        not a count of templates that exist.
      </p>

      <h2>Availability</h2>
      <p>
        The software is provided as it is, without a guarantee of uninterrupted availability. Export anything you cannot
        afford to lose.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can delete your account at any time from <Link href="/settings?tab=privacy">Account settings</Link>.
      </p>
    </>
  );
}
