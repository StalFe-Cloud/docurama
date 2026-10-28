/**
 * Compatibility shim: next/link -> TanStack Router Link.
 * Maps the Next.js `href` prop to TanStack's `to` prop so ported components
 * keep working unchanged.
 */
import { Link as TanStackLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";

type NextLinkProps = Omit<ComponentProps<typeof TanStackLink>, "to"> & {
  href: string;
  scroll?: boolean;
  replace?: boolean;
  prefetch?: boolean;
  shallow?: boolean;
  locale?: string | false;
};

export default function Link({ href, replace, ...rest }: NextLinkProps) {
  // External URLs and hash anchors render as plain anchors.
  if (/^(https?:|mailto:|tel:)/.test(href) || href.startsWith("#")) {
    const { children, className, ...anchorRest } = rest as Record<string, unknown>;
    void anchorRest;
    return (
      <a href={href} className={className as string | undefined}>
        {children as React.ReactNode}
      </a>
    );
  }
  return <TanStackLink to={href} replace={replace} {...(rest as object)} />;
}
