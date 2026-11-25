import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const LINK_CLASS =
    "inline-block max-w-full cursor-pointer truncate text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none";

type TableCellLinkProps = {
    children: ReactNode;
    className?: string;
    title?: string;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

/**
 * The one clickable value in a table row (usually its name): underlined on
 * hover, it opens the row's page (`href`) or drawer (`onClick`).
 */
export function TableCellLink({ children, className, title, href, onClick }: TableCellLinkProps) {
    if (href) {
        return (
            <Link href={href} title={title} className={cn(LINK_CLASS, className)}>
                {children}
            </Link>
        );
    }
    return (
        <button type="button" title={title} onClick={onClick} className={cn(LINK_CLASS, className)}>
            {children}
        </button>
    );
}
