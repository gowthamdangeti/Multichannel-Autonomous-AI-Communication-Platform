"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import * as React from "react"

import { cn } from "@/lib/utils"

interface DrawerProps extends React.ComponentProps<typeof DialogPrimitive.Root> {
  direction?: "top" | "bottom" | "left" | "right"
  shouldScaleBackground?: boolean
}

const DrawerContext = React.createContext<{ direction?: "top" | "bottom" | "left" | "right" }>({
  direction: "bottom",
})

function Drawer({
  direction = "bottom",
  ...props
}: DrawerProps) {
  return (
    <DrawerContext.Provider value={{ direction }}>
      <DialogPrimitive.Root data-slot="drawer" {...props} />
    </DrawerContext.Provider>
  )
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 backdrop-blur-xs transition-opacity duration-300",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const { direction = "bottom" } = React.useContext(DrawerContext)

  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        data-vaul-drawer-direction={direction}
        className={cn(
          "group/drawer-content fixed z-50 flex flex-col bg-background text-foreground transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out duration-300",
          // Vertical directions (top & bottom)
          direction === "top" && "inset-x-0 top-0 mb-24 max-h-[80vh] rounded-b-lg border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          direction === "bottom" && "inset-x-0 bottom-0 mt-24 max-h-[80vh] rounded-t-lg border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          // Horizontal side directions (right & left)
          // Same floating frame as Sheet: 8px gap + rounded on large screens, full-bleed on phones.
          (direction === "right" || direction === "left") &&
            "inset-y-0 overflow-hidden border-[length:var(--surface-border-width)] border-border lg:inset-y-2 lg:rounded-xl lg:shadow-surface-lg",
          direction === "right" && "right-0 lg:right-2 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          direction === "left" && "left-0 lg:left-2 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          className
        )}
        {...props}
      >
        {direction === "bottom" && (
          <div className="mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        )}
        {children}
      </DialogPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
