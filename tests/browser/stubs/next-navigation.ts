/** Harness stand-ins for next/navigation. Navigation is recorded, not performed. */
const navigations: string[] = [];
(window as unknown as { __navigations: string[] }).__navigations = navigations;

export function useRouter() {
  return {
    push: (href: string) => void navigations.push(href),
    replace: (href: string) => void navigations.push(href),
    refresh: () => undefined,
    back: () => undefined,
    prefetch: () => undefined,
  };
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}

export function usePathname() {
  return window.location.pathname;
}

export function redirect(href: string): never {
  navigations.push(href);
  throw new Error(`redirect:${href}`);
}
