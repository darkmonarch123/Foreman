import Link from "next/link";
import { Wordmark } from "@/components/ui/wordmark";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Overview" },
      { href: "/#collaboration", label: "Collaboration" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/register", label: "Create account" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/#templates", label: "Templates" },
      { href: "/#use-cases", label: "Use cases" },
      { href: "/join", label: "Join a board" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/#about", label: "About Foreman" },
      { href: "/#pricing", label: "Plans" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/cookies", label: "Cookie Policy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Wordmark className="text-xl" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">Plan visually. Build together.</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-sm font-medium text-ink">{column.title}</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {column.links.map((link) => (
                <li key={`${column.title}-${link.label}`}>
                  <Link href={link.href} className="text-sm text-muted hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-6 py-6 text-[13px] text-muted">
          Foreman is a real-time collaborative visual workspace built with Next.js and Supabase.
        </p>
      </div>
    </footer>
  );
}
