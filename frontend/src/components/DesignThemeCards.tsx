"use client";

import { Check } from "lucide-react";

import {
  DESIGN_THEME_LABELS,
  DESIGN_THEMES,
  type DesignTheme,
  useDesignTheme,
} from "@/context/DesignThemeContext";
import { cn } from "@/lib/utils";

const PREVIEW_LABELS: Record<DesignTheme, string> = {
  monochrome: "Monochrome",
  brutalist: "Neo-Brutalism",
  minimalist: "Minimalist",
  glassmorphism: "Glassmorphism",
  modernism: "Modernism",
};

function MonochromePreview() {
  return (
    <div className="flex h-full w-full gap-2 bg-sidebar p-2">
      <div className="w-1/4 space-y-1.5 pt-1">
        <div className="h-1.5 w-full rounded-full bg-foreground/30" />
        <div className="h-1.5 w-3/4 rounded-full bg-foreground/15" />
        <div className="h-1.5 w-3/4 rounded-full bg-foreground/15" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 rounded-md bg-background p-1.5">
        <div className="grid grid-cols-3 gap-1">
          <div className="h-5 rounded-sm border border-border bg-card" />
          <div className="h-5 rounded-sm border border-border bg-card" />
          <div className="h-5 rounded-sm border border-border bg-card" />
        </div>
        <div className="flex-1 rounded-sm border border-border bg-card" />
      </div>
    </div>
  );
}

function NeoBrutalismPreview() {
  return (
    <div className="flex h-full w-full flex-col gap-2 bg-white p-2">
      {/* Mini sidebar strip */}
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full border-[1.5px] border-black bg-white" />
        <div className="h-2 flex-1 rounded-sm bg-[#FDECEF]" />
      </div>
      {/* Mini table header */}
      <div className="mt-1 rounded-md border-[1.5px] border-black bg-[#FDECEF] px-2 py-1">
        <div className="h-1.5 w-3/4 rounded-full bg-black/20" />
      </div>
      {/* Mini rows */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 rounded-md border-[1.5px] border-black bg-white px-2 py-1.5 shadow-[2px_2px_0_0_#000]">
          <div className="h-1.5 w-1/3 rounded-full bg-black/20" />
          <div className="ml-auto h-2.5 w-6 rounded-sm bg-white border-[1.5px] border-black" />
        </div>
        <div className="flex items-center gap-1.5 rounded-md border-[1.5px] border-black bg-white px-2 py-1.5 shadow-[2px_2px_0_0_#000]">
          <div className="h-1.5 w-1/2 rounded-full bg-black/20" />
          <div className="ml-auto h-2.5 w-6 rounded-sm bg-white border-[1.5px] border-black" />
        </div>
      </div>
      {/* Mini archived bar */}
      <div className="mt-auto flex items-center gap-1.5 rounded-md border-[1.5px] border-black bg-[#FDECEF] px-2 py-1">
        <div className="h-1.5 w-1.5 rounded-full border-[1.5px] border-black bg-white" />
        <div className="h-1.5 w-10 rounded-full bg-black/20" />
        <div className="ml-auto h-2.5 w-4 rounded-sm border-[1.5px] border-black bg-white" />
      </div>
    </div>
  );
}

function MinimalistPreview() {
  return (
    <div className="flex h-full w-full flex-col gap-2 bg-white p-2">
      <div className="h-2 w-2/3 rounded-full bg-black/10" />
      <div className="mt-1 rounded-md border border-black/10 bg-black/5 px-2 py-1">
        <div className="h-1.5 w-3/4 rounded-full bg-black/10" />
      </div>
      <div className="space-y-1.5">
        <div className="rounded-md border border-black/10 bg-white px-2 py-1.5">
          <div className="h-1.5 w-1/3 rounded-full bg-black/10" />
        </div>
        <div className="rounded-md border border-black/10 bg-white px-2 py-1.5">
          <div className="h-1.5 w-1/2 rounded-full bg-black/10" />
        </div>
      </div>
    </div>
  );
}

function GlassmorphismPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 p-2">
      <div className="absolute inset-0 rounded-lg bg-white/40 backdrop-blur-sm" />
      <div className="relative z-10 flex h-full flex-col gap-2">
        <div className="h-2 w-2/3 rounded-full bg-black/10" />
        <div className="mt-1 rounded-xl border border-white/50 bg-white/50 px-2 py-1 backdrop-blur-md">
          <div className="h-1.5 w-3/4 rounded-full bg-black/10" />
        </div>
        <div className="space-y-1.5">
          <div className="rounded-xl border border-white/50 bg-white/50 px-2 py-1.5 backdrop-blur-md">
            <div className="h-1.5 w-1/3 rounded-full bg-black/10" />
          </div>
          <div className="rounded-xl border border-white/50 bg-white/50 px-2 py-1.5 backdrop-blur-md">
            <div className="h-1.5 w-1/2 rounded-full bg-black/10" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModernismPreview() {
  return (
    <div className="flex h-full w-full flex-col gap-2 bg-white p-2">
      <div className="h-2 w-2/3 rounded-full bg-black/10" />
      <div className="mt-1 rounded-lg border border-black/5 bg-white px-2 py-1 shadow-sm">
        <div className="h-1.5 w-3/4 rounded-full bg-black/10" />
      </div>
      <div className="space-y-1.5">
        <div className="rounded-lg border border-black/5 bg-white px-2 py-1.5 shadow-sm">
          <div className="h-1.5 w-1/3 rounded-full bg-black/10" />
        </div>
        <div className="rounded-lg border border-black/5 bg-white px-2 py-1.5 shadow-sm">
          <div className="h-1.5 w-1/2 rounded-full bg-black/10" />
        </div>
      </div>
    </div>
  );
}

const PREVIEWS: Record<DesignTheme, React.FC> = {
  monochrome: MonochromePreview,
  brutalist: NeoBrutalismPreview,
  minimalist: MinimalistPreview,
  glassmorphism: GlassmorphismPreview,
  modernism: ModernismPreview,
};

export function DesignThemeCards() {
  const { theme: currentTheme, setTheme } = useDesignTheme();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {DESIGN_THEMES.map((theme) => {
        const Preview = PREVIEWS[theme];
        const isActive = currentTheme === theme;
        return (
          <button
            key={theme}
            onClick={() => setTheme(theme)}
            className={cn(
              "design-theme-card group relative flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-2 text-left transition-all",
              "hover:translate-x-[var(--press-offset)] hover:translate-y-[var(--press-offset)] hover:shadow-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive && "ring-2 ring-ring"
            )}
            style={{ boxShadow: "var(--surface-shadow)" }}
            aria-pressed={isActive}
          >
            <div className="relative h-28 w-full overflow-hidden rounded-lg border border-border">
              <Preview />
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-foreground">
                {PREVIEW_LABELS[theme]}
              </span>
              {isActive && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>
            <span className="sr-only">{DESIGN_THEME_LABELS[theme]}</span>
          </button>
        );
      })}
    </div>
  );
}
