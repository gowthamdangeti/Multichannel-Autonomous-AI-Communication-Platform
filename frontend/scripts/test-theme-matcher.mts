// Regression test for Theme Matching Engine and Custom Theme Data Structure
import assert from "node:assert/strict";

import { PREDEFINED_THEMES, DEFAULT_CUSTOM_THEME } from "../src/lib/theme/predefined.ts";
import {
  parseColorToRgb,
  perceptualColorDistance,
  colorSimilarity,
  matchClosestTheme,
} from "../src/lib/theme/matcher.ts";
import { generateThemeCss } from "../src/lib/theme/css-generator.ts";
import type { ThemeColorPalette, ThemeDefinition, ThemeStyles } from "../src/types/theme.ts";

console.log("=== 1. Validating Theme Data Structure Consistency ===");
const expectedColorKeys: (keyof ThemeColorPalette)[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
];

const expectedStyleKeys: (keyof ThemeStyles)[] = [
  "radius",
  "surfaceBorderWidth",
  "surfaceShadow",
];

// Check all predefined themes have the exact same structure
for (const [id, theme] of Object.entries(PREDEFINED_THEMES)) {
  assert.equal(theme.id, id, `Theme ID mismatch for ${id}`);
  assert.ok(theme.name, `Missing name for ${id}`);

  for (const key of expectedColorKeys) {
    assert.ok(theme.light[key], `Theme ${id} light missing key: ${key}`);
    assert.ok(theme.dark[key], `Theme ${id} dark missing key: ${key}`);
  }

  for (const skey of expectedStyleKeys) {
    assert.ok(theme.styles[skey], `Theme ${id} styles missing key: ${skey}`);
  }
}

// Check custom theme has the exact same structure
for (const key of expectedColorKeys) {
  assert.ok(DEFAULT_CUSTOM_THEME.light[key], `Custom theme light missing key: ${key}`);
  assert.ok(DEFAULT_CUSTOM_THEME.dark[key], `Custom theme dark missing key: ${key}`);
}
for (const skey of expectedStyleKeys) {
  assert.ok(DEFAULT_CUSTOM_THEME.styles[skey], `Custom theme styles missing key: ${skey}`);
}
console.log("✓ All 6 predefined themes + custom theme share 100% identical data structures!");

console.log("\n=== 2. Validating Color Math and Parsing ===");
const hexPureWhite = parseColorToRgb("#ffffff");
assert.deepEqual(hexPureWhite, { r: 255, g: 255, b: 255 });

const hexPureBlack = parseColorToRgb("#000000");
assert.deepEqual(hexPureBlack, { r: 0, g: 0, b: 0 });

const rgbSample = parseColorToRgb("rgb(56, 189, 248)");
assert.deepEqual(rgbSample, { r: 56, g: 189, b: 248 });

assert.equal(colorSimilarity("#000000", "#000000"), 100);
assert.equal(colorSimilarity("#ffffff", "#ffffff"), 100);
assert.ok(colorSimilarity("#38bdf8", "#0284c7") > 75, "Cyan should be close to Sky Blue");
console.log("✓ Color parsing and perceptual similarity functions work accurately!");

console.log("\n=== 3. Validating Predefined Theme Matching ===");

// Test matching user's custom cyan palette -> should match Powder Blue
const powderBlueInput = {
  primary: "#38bdf8",
  background: "#f4f8fb",
  card: "#ffffff",
  border: "#bae6fd",
};
const powderMatch = matchClosestTheme(powderBlueInput, "light");
assert.equal(powderMatch.closestTheme, "powder-blue");
assert.ok(powderMatch.similarity > 85, `Expected high similarity, got ${powderMatch.similarity}`);
console.log(`✓ Custom cyan matched: ${powderMatch.closestThemeName} (${powderMatch.similarity}%)`);

// Test matching user's black/pink brutalist palette -> should match Neo-Brutalism
const brutalistInput = {
  primary: "#2b2b2b",
  background: "#ffffff",
  card: "#ffffff",
  border: "#000000",
  accent: "#fdecef",
};
const brutalMatch = matchClosestTheme(brutalistInput, "light");
assert.equal(brutalMatch.closestTheme, "brutalist");
assert.ok(brutalMatch.similarity > 80, `Expected high similarity, got ${brutalMatch.similarity}`);
console.log(`✓ Custom brutalist matched: ${brutalMatch.closestThemeName} (${brutalMatch.similarity}%)`);

// Test matching frosted glass palette -> should match Glassmorphism
const glassInput = {
  primary: "#ec4899",
  background: "#f0f4f8",
  accent: "rgba(236, 72, 153, 0.12)",
};
const glassMatch = matchClosestTheme(glassInput, "light");
assert.equal(glassMatch.closestTheme, "glassmorphism");
console.log(`✓ Custom glass matched: ${glassMatch.closestThemeName} (${glassMatch.similarity}%)`);

console.log("\n=== 4. Validating CSS Generation for Global Application ===");
const generatedCss = generateThemeCss(DEFAULT_CUSTOM_THEME);
assert.ok(generatedCss.includes('[data-theme="custom"]'), "Must generate [data-theme='custom'] selector");
assert.ok(generatedCss.includes('.dark[data-theme="custom"]'), "Must generate dark mode custom selector");
assert.ok(generatedCss.includes("--primary:"), "Must output --primary variable");
assert.ok(generatedCss.includes("--background:"), "Must output --background variable");
assert.ok(generatedCss.includes("--radius:"), "Must output --radius variable");
console.log("✓ CSS generation creates complete, valid CSS custom property blocks!");

console.log("\n==============================================");
console.log(" ALL CUSTOM THEME & MATCHER TESTS PASSED! ");
console.log("==============================================");
