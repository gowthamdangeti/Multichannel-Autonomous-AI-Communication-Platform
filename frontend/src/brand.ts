/**
 * Convozent brand configuration — single source of truth.
 *
 * Change anything here and it propagates everywhere:
 *   - BrandLogo component (name, monogram, font)
 *   - <title> and <meta> tags (layout.tsx reads BRAND.name)
 *   - Footer links
 *   - App description
 *   - Support / docs URLs
 *
 * Colors and fonts are in globals.css (@theme block) so Tailwind picks
 * them up as utility classes — edit there for visual changes.
 *
 * This file is Convozent-owned: convozent updates never touch it.
 */

export const BRAND = {
  /** Displayed name everywhere (sidebar, tab title, emails). */
  name: "Convozent",

  /** Short monogram used in the collapsed sidebar and favicon. */
  monogram: "C",

  /** One-line product description used in <meta> and login page. */
  tagline: "The voice agent platform for production AI.",

  /** Support / contact email. */
  supportEmail: "hello@convozent.ai",

  /** Public website. */
  website: "https://convozent.ai",

  /** Documentation base URL. */
  docsUrl: "https://docs.convozent.ai",

  /** Privacy policy page. */
  privacyUrl: "https://convozent.ai/privacy",

  /** Terms of service page. */
  termsUrl: "https://convozent.ai/terms",

  /**
   * CSS font-family string for the display / wordmark font.
   * Must match the font variable loaded in layout.tsx.
   * Default: system sans-serif (same as the app body font).
   * Set to e.g. "var(--font-playfair-display), serif" if you load a custom font.
   */
  wordmarkFont: "inherit",

  /**
   * Wordmark style overrides — applied inline on the <span> in BrandLogo.
   * Use this to set letter-spacing, font-weight, font-size scale, etc.
   * without touching Tailwind classes.
   */
  wordmarkStyle: {
    fontWeight: "700",
    letterSpacing: "-0.02em",
  },
} as const;
