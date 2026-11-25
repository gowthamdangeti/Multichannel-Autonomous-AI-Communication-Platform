"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeDefinition } from "@/types/theme";
import { DEFAULT_CUSTOM_THEME } from "@/lib/theme/predefined";
import { injectCustomThemeCss } from "@/lib/theme/css-generator";

export const DESIGN_THEMES = [
  "monochrome",
  "powder-blue",
  "brutalist",
  "minimalist",
  "glassmorphism",
  "modernism",
  "custom",
] as const;

export type DesignTheme = (typeof DESIGN_THEMES)[number];

export const DESIGN_THEME_LABELS: Record<DesignTheme, string> = {
  monochrome: "Monochrome",
  "powder-blue": "Powder Blue",
  brutalist: "Neo-Brutalism",
  minimalist: "Minimalist",
  glassmorphism: "Glassmorphism",
  modernism: "Modernism",
  custom: "Custom Theme",
};

const STORAGE_KEY = "design-theme-v2";
const CUSTOM_THEME_STORAGE_KEY = "custom-theme-definition";
const DEFAULT_THEME: DesignTheme = "powder-blue";

interface DesignThemeContextType {
  theme: DesignTheme;
  setTheme: (theme: DesignTheme) => void;
  customTheme: ThemeDefinition;
  setCustomTheme: (theme: ThemeDefinition) => void;
  saveCustomTheme: (theme: ThemeDefinition) => void;
  resetCustomTheme: () => void;
}

const DesignThemeContext = createContext<DesignThemeContextType | undefined>(undefined);

export function DesignThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<DesignTheme>(DEFAULT_THEME);
  const [customTheme, setCustomThemeState] = useState<ThemeDefinition>(DEFAULT_CUSTOM_THEME);

  useEffect(() => {
    // 1. Load custom theme definition if stored
    let loadedCustomTheme = DEFAULT_CUSTOM_THEME;
    try {
      const storedCustom = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
      if (storedCustom) {
        const parsed = JSON.parse(storedCustom) as ThemeDefinition;
        if (parsed && parsed.light && parsed.dark && parsed.styles) {
          loadedCustomTheme = parsed;
          setCustomThemeState(parsed);
        }
      }
    } catch {
      // Storage parsing failed, stick with default
    }

    // Always inject the custom theme CSS so [data-theme="custom"] is immediately ready
    injectCustomThemeCss(loadedCustomTheme);

    // 2. Read what is currently applied to document or storage
    const current = document.documentElement.getAttribute("data-theme") as DesignTheme | null;
    if (current && DESIGN_THEMES.includes(current)) {
      setThemeState(current);
    } else {
      try {
        const storedTheme = localStorage.getItem(STORAGE_KEY) as DesignTheme | null;
        if (storedTheme && DESIGN_THEMES.includes(storedTheme)) {
          setThemeState(storedTheme);
          document.documentElement.setAttribute("data-theme", storedTheme);
        }
      } catch {
        // Fallback to default
      }
    }
  }, []);

  const setTheme = (next: DesignTheme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable
    }
    document.documentElement.setAttribute("data-theme", next);

    if (next === "custom") {
      injectCustomThemeCss(customTheme);
    }
  };

  const saveCustomTheme = (nextCustomTheme: ThemeDefinition) => {
    setCustomThemeState(nextCustomTheme);
    try {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(nextCustomTheme));
    } catch {
      // Storage unavailable
    }
    injectCustomThemeCss(nextCustomTheme);
  };

  const setCustomTheme = (nextCustomTheme: ThemeDefinition) => {
    setCustomThemeState(nextCustomTheme);
    injectCustomThemeCss(nextCustomTheme);
  };

  const resetCustomTheme = () => {
    saveCustomTheme(DEFAULT_CUSTOM_THEME);
  };

  return (
    <DesignThemeContext.Provider
      value={{
        theme,
        setTheme,
        customTheme,
        setCustomTheme,
        saveCustomTheme,
        resetCustomTheme,
      }}
    >
      {children}
    </DesignThemeContext.Provider>
  );
}

export function useDesignTheme() {
  const context = useContext(DesignThemeContext);
  if (!context) {
    throw new Error("useDesignTheme must be used within a DesignThemeProvider");
  }
  return context;
}
