"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { recordCookieConsentAction } from "@/lib/auth/actions";
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, parseConsent, type ConsentChoice } from "@/lib/consent";
import { Button } from "./ui/button";
import { Toggle } from "./ui/field";
import { Modal } from "./ui/modal";

const OPEN_EVENT = "foreman:open-cookie-preferences";
const CHANGE_EVENT = "foreman:cookie-consent-changed";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/** Lets any page open the preferences dialog (used on /cookies). */
export function openCookiePreferences(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CookieConsent() {
  // "unknown" on the server and during hydration, so nothing flashes.
  const stored = useSyncExternalStore<string | null | undefined>(subscribe, readStored, () => undefined);
  const choice = stored === undefined ? undefined : parseConsent(stored);
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(false);

  useEffect(() => {
    function onOpen() {
      const current = parseConsent(readStored());
      setAnalytics(current?.analytics ?? false);
      setPreferences(current?.preferences ?? false);
      setManaging(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const save = useCallback((next: { analytics: boolean; preferences: boolean }) => {
    const record: ConsentChoice = { version: CONSENT_VERSION, ...next, decidedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage unavailable: the choice applies to this page view only.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    setManaging(false);
    // For signed-in people the choice is also recorded with a timestamp and version.
    void recordCookieConsentAction({ version: CONSENT_VERSION, ...next });
  }, []);

  const showBanner = choice === null && !managing;

  return (
    <>
      {showBanner ? (
        <section
          aria-label="Cookie preferences"
          className="fixed inset-x-3 bottom-3 z-40 max-w-md rounded-card border border-line bg-surface p-5 shadow-lift sm:inset-x-auto sm:bottom-5 sm:left-5"
        >
          <p className="text-[13px] leading-relaxed text-ink">
            Foreman uses essential cookies to keep you signed in and secure. It does not use analytics or advertising
            cookies today. Your choice here is recorded and will apply if optional cookies are ever introduced.{" "}
            <Link href="/cookies" className="underline underline-offset-2">
              Cookie policy
            </Link>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => save({ analytics: true, preferences: true })}>
              Accept optional cookies
            </Button>
            <Button size="sm" variant="secondary" onClick={() => save({ analytics: false, preferences: false })}>
              Reject optional cookies
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAnalytics(false);
                setPreferences(false);
                setManaging(true);
              }}
            >
              Manage preferences
            </Button>
          </div>
        </section>
      ) : null}

      <Modal
        open={managing}
        onClose={() => setManaging(false)}
        title="Cookie preferences"
        description="Essential cookies are always on. Optional categories are off unless you turn them on."
        footer={
          <>
            <Button variant="ghost" onClick={() => setManaging(false)}>
              Cancel
            </Button>
            <Button onClick={() => save({ analytics, preferences })}>Save preferences</Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Toggle
            label="Essential"
            description="Sign-in session and security. Required for Foreman to work, so this cannot be turned off."
            checked
            disabled
            onChange={() => {}}
          />
          <Toggle
            label="Preferences"
            description="Would remember interface choices across devices. Not in use today."
            checked={preferences}
            onChange={setPreferences}
          />
          <Toggle
            label="Analytics"
            description="Would measure how Foreman is used. Not in use today; nothing is loaded."
            checked={analytics}
            onChange={setAnalytics}
          />
        </div>
      </Modal>
    </>
  );
}
