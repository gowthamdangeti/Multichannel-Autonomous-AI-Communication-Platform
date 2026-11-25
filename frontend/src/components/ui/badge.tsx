import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-all duration-200 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 select-none shrink-0 whitespace-nowrap",
    {
        variants: {
            variant: {
                default:
                    "border-primary/30 bg-primary/15 text-primary hover:bg-primary/25 hover:border-primary/50",
                primary:
                    "border-primary/30 bg-primary/15 text-primary hover:bg-primary/25 hover:border-primary/50",
                secondary:
                    "border-border/50 bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 dark:bg-zinc-800/60 dark:border-zinc-700/60 dark:text-zinc-300",
                destructive:
                    "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 hover:border-rose-500/50",
                rose:
                    "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 hover:border-rose-500/50",
                outline:
                    "border-border/60 bg-background/40 text-foreground hover:bg-accent/40 hover:border-border",
                success:
                    "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-500/50",
                emerald:
                    "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-500/50",
                warning:
                    "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/50",
                amber:
                    "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/50",
                info:
                    "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300 hover:bg-sky-500/25 hover:border-sky-500/50",
                sky:
                    "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300 hover:bg-sky-500/25 hover:border-sky-500/50",
                purple:
                    "border-purple-500/30 bg-purple-500/15 text-purple-700 dark:text-purple-300 hover:bg-purple-500/25 hover:border-purple-500/50",
                violet:
                    "border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300 hover:bg-violet-500/25 hover:border-violet-500/50",
                pink:
                    "border-pink-500/30 bg-pink-500/15 text-pink-700 dark:text-pink-300 hover:bg-pink-500/25 hover:border-pink-500/50",
                indigo:
                    "border-indigo-500/30 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/25 hover:border-indigo-500/50",
                cyan:
                    "border-cyan-500/30 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 hover:border-cyan-500/50",
                glass:
                    "border-white/20 dark:border-white/10 bg-white/20 dark:bg-white/10 text-foreground hover:bg-white/30 dark:hover:bg-white/15",
            },
            size: {
                default: "px-2.5 py-0.5 text-xs",
                sm: "px-2 py-0.25 text-[11px]",
                lg: "px-3 py-1 text-xs",
            }
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
    ({ className, variant, size, ...props }, ref) => {
        return (
            <div
                ref={ref}
                data-slot="badge"
                className={cn(badgeVariants({ variant, size }), className)}
                {...props}
            />
        )
    }
)
Badge.displayName = "Badge"

export { Badge, badgeVariants }

