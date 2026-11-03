import type { FooterColumn } from "@/components/ui/footer";
import type { NavLink } from "@/components/ui/navbar";

/** Every link on the public landing page, in one place. Routes match the rest of the app. */
export const NAV_LINKS: NavLink[] = [
  { href: "/#product", label: "Product" },
  { href: "/#templates", label: "Templates" },
  { href: "/#collaboration", label: "Collaboration" },
  { href: "/#pricing", label: "Pricing" },
];

export const LOGIN: NavLink = { href: "/login", label: "Log in" };
export const SIGNUP: NavLink = { href: "/register", label: "Create account" };

export const FOOTER_COLUMNS: FooterColumn[] = [
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
