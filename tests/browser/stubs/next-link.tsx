import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Harness stand-in for next/link. */
export default function Link({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  );
}
