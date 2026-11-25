"use client";

// Parallel to DesignThemeContext (data-theme) and next-themes (light/dark).
// Controls the *UI font family* via a `data-font` attribute on <html>, each
// value mapping to a font stack in globals.css (--app-font-ui, consumed by
// the `font-sans` Tailwind token and by `body`). Persisted to localStorage
// under "font-family-v2"; a matching inline script in layout.tsx sets the
// attribute before hydration to avoid a flash.
//
// The stacks themselves live in CSS (globals.css :root[data-font="…"]) so the
// pre-hydration script already renders in the chosen font; this context only
// keeps React state in sync with the DOM and persists changes.

import { createContext, useContext, useEffect, useState } from "react";

export const FONT_FAMILIES = ["geist", "inter", "playfair", "bricolage", "system"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  geist: "Geist",
  inter: "Inter",
  playfair: "Playfair Display",
  bricolage: "Bricolage Grotesque",
  system: "System",
};

const STORAGE_KEY = "font-family-v2";
const DEFAULT_FONT: FontFamily = "geist";

interface FontFamilyContextType {
  fontFamily: FontFamily;
  setFontFamily: (fontFamily: FontFamily) => void;
}

const FontFamilyContext = createContext<FontFamilyContextType | undefined>(undefined);

export function FontFamilyProvider({ children }: { children: React.ReactNode }) {
  const [fontFamily, setFontFamilyState] = useState<FontFamily>(DEFAULT_FONT);

  useEffect(() => {
    // Read what the inline script already applied to the DOM, so state matches.
    const current = document.documentElement.getAttribute("data-font") as FontFamily | null;
    if (current && FONT_FAMILIES.includes(current)) {
      setFontFamilyState(current);
    }
  }, []);

  const setFontFamily = (next: FontFamily) => {
    setFontFamilyState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private browsing) — choice just won't persist.
    }
    document.documentElement.setAttribute("data-font", next);
  };

  return (
    <FontFamilyContext.Provider value={{ fontFamily, setFontFamily }}>
      {children}
    </FontFamilyContext.Provider>
  );
}

export function useFontFamily() {
  const context = useContext(FontFamilyContext);
  if (!context) {
    throw new Error("useFontFamily must be used within a FontFamilyProvider");
  }
  return context;
}
