import { Menu } from "lucide-react";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

const links = [
  { href: "/#product", label: "Product" },
  { href: "/#templates", label: "Templates" },
  { href: "/#collaboration", label: "Collaboration" },
  { href: "/#pricing", label: "Pricing" },
];

/** Floating, rounded navigation bar for public pages. */
export function SiteNav() {
  return (
    <header className="sticky top-3 z-30 px-3 sm:top-5 sm:px-6">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 rounded-full border border-line bg-surface/90 pl-6 pr-2 shadow-soft backdrop-blur"
      >
        <Link href="/" className="shrink-0 text-lg" aria-label="Foreman home">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-full px-3.5 py-2 text-sm text-muted transition-colors hover:bg-ink/5 hover:text-ink"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1">
          <Link
            href="/login"
            className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-ink hover:bg-ink/5 sm:inline-flex"
          >
            Log in
          </Link>
          <LinkButton href="/register" size="md">
            Create account
          </LinkButton>

          {/* Small screens: a native disclosure, so it works without JavaScript. */}
          <details className="group relative md:hidden">
            <summary
              className="flex size-10 list-none items-center justify-center rounded-full hover:bg-ink/5 [&::-webkit-details-marker]:hidden"
              aria-label="Menu"
            >
              <Menu className="size-5" aria-hidden />
            </summary>
            <ul className="absolute right-0 top-12 w-56 rounded-card border border-line bg-surface p-2 shadow-lift">
              {[...links, { href: "/login", label: "Log in" }].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-ink/5">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </nav>
    </header>
  );
}
