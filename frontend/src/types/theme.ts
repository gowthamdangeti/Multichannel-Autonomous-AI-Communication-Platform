export type PredefinedThemeId =
  | "monochrome"
  | "powder-blue"
  | "brutalist"
  | "minimalist"
  | "glassmorphism"
  | "modernism";

export type ThemeId = PredefinedThemeId | "custom";

export interface ThemeColorPalette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  borderHover?: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  cta?: string;
  ctaForeground?: string;
  statusSuccess?: string;
  statusWarning?: string;
}

export interface ThemeStyles {
  radius: string; // e.g., "0.625rem"
  radiusSidebar?: string;
  radiusCard?: string;
  radiusButton?: string;
  radiusInput?: string;
  radiusBadge?: string;
  surfaceBorderWidth: string; // e.g., "1px", "1.5px"
  surfaceShadow: string; // e.g., "0 1px 3px rgba(0,0,0,0.1)", "3px 3px 0 0 #000"
  surfaceShadowLg?: string;
  surfaceShadowSm?: string;
  buttonShadow?: string;
  inputShadow?: string;
  surfaceBlur?: string; // e.g., "0px", "16px"
  pressOffset?: string; // e.g., "0px", "1px", "2px"
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  light: ThemeColorPalette;
  dark: ThemeColorPalette;
  styles: ThemeStyles;
}

export interface ThemeMatchRanking {
  theme: PredefinedThemeId;
  name: string;
  similarity: number; // 0 - 100 percentage
}

export interface ThemeMatchResult {
  closestTheme: PredefinedThemeId;
  closestThemeName: string;
  similarity: number; // 0 - 100 percentage
  rankings: ThemeMatchRanking[];
  breakdown: {
    primaryMatch: number;
    backgroundMatch: number;
    surfaceMatch: number;
    accentMatch: number;
    borderMatch: number;
  };
  reasoning: string;
}
