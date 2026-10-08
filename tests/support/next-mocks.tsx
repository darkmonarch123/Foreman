import type { AnchorHTMLAttributes, ReactNode } from "react";
import { vi } from "vitest";

/** Shared mock state for next/navigation in component tests. */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

let search = new URLSearchParams();

export function setSearchParams(value: string): void {
  search = new URLSearchParams(value);
}

export function resetNextMocks(): void {
  for (const fn of Object.values(router)) fn.mockReset();
  search = new URLSearchParams();
}

export const navigationMock = {
  useRouter: () => router,
  useSearchParams: () => search,
  usePathname: () => "/",
};

export function LinkMock({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
