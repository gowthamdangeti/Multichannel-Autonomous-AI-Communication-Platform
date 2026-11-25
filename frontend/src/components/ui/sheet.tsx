"use client"

import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  headerOffset,
  floating,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  headerOffset?: number
  floating?: boolean
}) {
  let offsetStyle: React.CSSProperties | undefined = undefined;
  if (headerOffset) {
    if (floating) {
      offsetStyle = { top: `${headerOffset + 16}px`, height: `calc(100vh - ${headerOffset + 32}px)` }
    } else {
      offsetStyle = { top: `${headerOffset}px`, height: `calc(100vh - ${headerOffset}px)` }
    }
  } else if (floating) {
    offsetStyle = { top: `16px`, height: `calc(100vh - 32px)` }
  }

  React.useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, []);

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn(
          // The drawer never scrolls itself: SheetHeader / SheetFooter stay put and
          // only SheetBody scrolls.
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 overflow-hidden shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          // Side drawers float with the same 8px gap and rounded corners as the
          // page (SidebarInset m-2 / rounded-xl) on large screens; full-bleed on phones.
          (side === "right" || side === "left") &&
            "border-[length:var(--surface-border-width)] border-border lg:rounded-xl lg:shadow-surface-lg",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0 w-full sm:w-[45%] sm:max-w-[45%] lg:right-2",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0 w-3/4 sm:max-w-sm lg:left-2",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b-2 border-border",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t-2 border-border",
          !headerOffset && !floating && (side === "right" || side === "left") && "inset-y-0 lg:inset-y-2",
          className
        )}
        style={offsetStyle}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center border-[length:var(--surface-border-width)] border-border bg-background shadow-button hover:bg-accent hover:text-accent-foreground hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none active:translate-x-[var(--press-offset)] active:translate-y-[var(--press-offset)] active:shadow-none transition-all disabled:pointer-events-none rounded-sm cursor-pointer">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

/** The scrolling middle of a drawer, between SheetHeader and SheetFooter. */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-row items-center justify-end gap-2.5 px-4 py-2.5 border-t border-border/60 bg-card/95 shrink-0", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
