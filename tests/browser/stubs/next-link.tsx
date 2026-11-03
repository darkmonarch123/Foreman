import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Harness stand-in for next/link. */
export default function Link({
  href,
  children,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  // Like next/link, the link's own onClick still runs; the harness just never navigates away.
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
