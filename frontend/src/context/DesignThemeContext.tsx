"use client";

// Parallel to next-themes (which only handles light/dark). This controls the
// *design language* — monochrome / brutalist / minimalist / glassmorphism / modernism —
// applied via a `data-theme` attribute on <html>, each with its own CSS
// custom properties in globals.css (colors, border width, shadow, blur).
// Persisted to localStorage under "design-theme-v2" (v2 moved everyone to the
// Monochrome default once, ignoring older saved themes); a matching inline script in
// layout.tsx sets the attribute before hydration to avoid a flash.

import { createContext, useContext, useEffect, useState } from "react";

export const DESIGN_THEMES = ["monochrome", "brutalist", "minimalist", "glassmorphism", "modernism"] as const;
export type DesignTheme = (typeof DESIGN_THEMES)[number];

export const DESIGN_THEME_LABELS: Record<DesignTheme, string> = {
  monochrome: "Monochrome",
  brutalist: "Neo-Brutalism",
  minimalist: "Minimalist",
  glassmorphism: "Glassmorphism",
  modernism: "Modernism",
};

const STORAGE_KEY = "design-theme-v2";
const DEFAULT_THEME: DesignTheme = "monochrome";

interface DesignThemeContextType {
  theme: DesignTheme;
  setTheme: (theme: DesignTheme) => void;
}

const DesignThemeContext = createContext<DesignThemeContextType | undefined>(undefined);

export function DesignThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<DesignTheme>(DEFAULT_THEME);

  useEffect(() => {
    // Read what the inline script already applied to the DOM, so state matches.
    const current = document.documentElement.getAttribute("data-theme") as DesignTheme | null;
    if (current && DESIGN_THEMES.includes(current)) {
      setThemeState(current);
    }
  }, []);

  const setTheme = (next: DesignTheme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private browsing) — theme just won't persist.
    }
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <DesignThemeContext.Provider value={{ theme, setTheme }}>
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
