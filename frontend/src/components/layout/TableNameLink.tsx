import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface TableNameLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * The name in a table row that opens its detail page, styled like the
 * telephony configurations table. A real link, so it opens in a new tab too.
 */
export function TableNameLink({ href, children, className }: TableNameLinkProps) {
  return (
    <Link
      href={href}
      // Rows also navigate on click; stopping here avoids a second navigation.
      onClick={(event) => event.stopPropagation()}
      className={cn("font-semibold text-foreground hover:underline", className)}
    >
      {children}
    </Link>
  );
}
