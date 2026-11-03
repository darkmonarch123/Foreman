import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "./container";
import type { NavLink } from "./navbar";

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

interface FooterProps {
  summary: ReactNode;
  columns: FooterColumn[];
  legal: ReactNode;
  aside?: ReactNode;
}

/** The site footer: a one-line summary, link columns, then the legal line. */
export function Footer({ summary, columns, legal, aside }: FooterProps) {
  return (
    <footer className="border-t border-site-line bg-site-bg-alt pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-10 text-site-caption text-site-label-2">
      <Container>
        <p className="border-b border-site-line-strong pb-5 leading-relaxed">{summary}</p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 py-6 sm:grid-cols-4">
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="mb-1 text-site-caption font-semibold text-site-label">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    {/* min-h-11 keeps each footer link a comfortable touch target. */}
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 items-center hover:text-site-label hover:underline sm:min-h-8"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-site-line-strong pt-4">
          <span>{legal}</span>
          {aside ? <span>{aside}</span> : null}
        </div>
      </Container>
    </footer>
  );
}
