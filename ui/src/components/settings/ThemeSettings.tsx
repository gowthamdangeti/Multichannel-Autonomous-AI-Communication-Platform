"use client";

import { DesignThemeCards } from "@/components/DesignThemeCards";
import { DesignThemeSwitcher } from "@/components/DesignThemeSwitcher";
import { FontFamilySelect } from "@/components/FontFamilySelect";
import ThemeToggle from "@/components/ThemeSwitcher";
import { CustomThemeCreator } from "@/components/theme/CustomThemeCreator";

export function ThemeSettings() {
  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 settings-row-container">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Mode</p>
          <p className="text-sm text-muted-foreground">
            Choose how the app looks on this device.
          </p>
        </div>
        <ThemeToggle
          showLabel
          variant="outline"
          size="default"
          className="w-auto"
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 settings-row-container">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Font family</p>
          <p className="text-sm text-muted-foreground">
            Pick the font used across the whole app.
          </p>
        </div>
        <FontFamilySelect />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 settings-row-container">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Design theme</p>
            <p className="text-sm text-muted-foreground">
              Pick a visual style for the whole app.
            </p>
          </div>
          <DesignThemeSwitcher />
        </div>
        <DesignThemeCards />
        <p className="text-xs text-muted-foreground">
          Neo-Brutalism uses thick black borders, hard shadows, and soft light
          pink accents only on selected navigation, table headers, and archived
          sections.
        </p>
      </div>

      {/* Custom Theme Studio */}
      <div className="pt-2">
        <CustomThemeCreator />
      </div>
    </>
  );
}
