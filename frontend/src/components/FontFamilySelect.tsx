"use client";

// Preview stacks here are for the dropdown labels only — the effective UI
// stacks live in globals.css (:root[data-font="…"] → --app-font-ui) and are
// the source of truth for rendering. Keep both in sync when adding a font.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FONT_FAMILIES, FONT_FAMILY_LABELS, type FontFamily,useFontFamily } from "@/context/FontFamilyContext";

const PREVIEW_STACKS: Record<FontFamily, string> = {
  geist: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  playfair: "var(--font-playfair), Georgia, 'Times New Roman', serif",
  bricolage: "var(--font-bricolage), ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

export function FontFamilySelect() {
  const { fontFamily, setFontFamily } = useFontFamily();

  return (
    <Select value={fontFamily} onValueChange={(value) => setFontFamily(value as FontFamily)}>
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FONT_FAMILIES.map((option) => (
          <SelectItem key={option} value={option} style={{ fontFamily: PREVIEW_STACKS[option] }}>
            {FONT_FAMILY_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
