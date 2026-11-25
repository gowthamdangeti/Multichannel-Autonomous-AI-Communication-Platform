"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DESIGN_THEME_LABELS, DESIGN_THEMES, useDesignTheme } from "@/context/DesignThemeContext";

export function DesignThemeSwitcher() {
  const { theme, setTheme } = useDesignTheme();

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DESIGN_THEMES.map((option) => (
          <SelectItem key={option} value={option}>
            {DESIGN_THEME_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
