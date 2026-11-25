import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Padding on the select trigger so text does not collide with the preview button on the right. */
export const SELECT_WITH_PREVIEW_PADDING = "pr-16";

interface SelectPreviewSlotProps {
    /** Preview button placed inside the selector on the right side before the chevron. */
    action: ReactNode;
    children: ReactNode;
    className?: string;
}

/** Places a preview button INSIDE the select box on the right, beside the stack name and before the chevron. */
export function SelectPreviewSlot({ action, children, className }: SelectPreviewSlotProps) {
    return (
        <div className={cn("relative flex items-center", className)}>
            <div className="w-full">{children}</div>
            {action && (
                <div
                    className="absolute right-8 top-1/2 z-10 -translate-y-1/2 flex items-center"
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    }}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                    }}
                >
                    {action}
                </div>
            )}
        </div>
    );
}
