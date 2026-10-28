/**
 * Compatibility shim: next/navigation -> TanStack Router equivalents.
 */
import { useLocation, useNavigate } from "@tanstack/react-router";

export function usePathname(): string {
  return useLocation({ select: (l) => l.pathname });
}

export function useSearchParams(): URLSearchParams {
  const search = useLocation({ select: (l) => l.searchStr });
  return new URLSearchParams(search);
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href: string) => void navigate({ to: href }),
    replace: (href: string) => void navigate({ to: href, replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: () => undefined,
  };
}

export function notFound(): never {
  throw new Error("NOT_FOUND");
}

export function redirect(url: string): never {
  window.location.assign(url);
  throw new Error("REDIRECT");
}

export function permanentRedirect(url: string): never {
  window.location.assign(url);
  throw new Error("REDIRECT");
}
