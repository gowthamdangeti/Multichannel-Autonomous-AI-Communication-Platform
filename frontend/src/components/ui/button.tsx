import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-0 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border-[length:var(--surface-border-width)] border-border bg-primary text-primary-foreground shadow-button hover:bg-primary/90 hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none active:translate-x-[var(--press-offset)] active:translate-y-[var(--press-offset)] active:shadow-none",
        destructive:
          "border-[length:var(--surface-border-width)] border-border bg-destructive text-white shadow-button hover:bg-destructive/90 hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none active:translate-x-[var(--press-offset)] active:translate-y-[var(--press-offset)] active:shadow-none focus-visible:ring-destructive/20",
        outline:
          "border-[length:var(--surface-border-width)] border-border bg-card shadow-button hover:bg-accent hover:text-accent-foreground hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none active:translate-x-[var(--press-offset)] active:translate-y-[var(--press-offset)] active:shadow-none",
        secondary:
          "border-[length:var(--surface-border-width)] border-border bg-secondary text-secondary-foreground shadow-button hover:bg-secondary/80 hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none active:translate-x-[var(--press-offset)] active:translate-y-[var(--press-offset)] active:shadow-none",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
