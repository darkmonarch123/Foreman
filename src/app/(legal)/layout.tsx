import type { ReactNode } from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-3xl px-6 pb-8 pt-16 sm:pt-24">
        <div className="prose-legal">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
