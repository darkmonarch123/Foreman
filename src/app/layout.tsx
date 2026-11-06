import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/full.css";
import "./globals.css";
import { CookieConsent } from "@/components/cookie-consent";
import { ThemeController } from "@/components/theme/theme-controller";
import { ToastProvider } from "@/components/ui/toast";
import { getSiteUrl } from "@/lib/env";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Foreman — Plan visually. Build together.",
    template: "%s · Foreman",
  },
  description:
    "Foreman brings your team's ideas, tasks, and visual plans into one shared workspace: boards, sticky notes, diagrams and real-time collaboration.",
  applicationName: "Foreman",
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121216" },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set before paint by the inline script, so React must not treat it as a mismatch.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <ThemeController />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-canvas"
        >
          Skip to content
        </a>
        <ToastProvider>
          {children}
          <CookieConsent />
        </ToastProvider>
      </body>
    </html>
  );
}
