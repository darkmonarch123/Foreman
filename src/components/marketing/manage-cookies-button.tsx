"use client";

import { openCookiePreferences } from "@/components/cookie-consent";
import { Button } from "@/components/ui/button";

export function ManageCookiesButton() {
  return (
    <Button variant="secondary" onClick={() => openCookiePreferences()}>
      Manage preferences
    </Button>
  );
}
