import { BRAND } from "@/brand";
import { cn } from "@/lib/utils";

/**
 * Convozent wordmark / monogram component.
 *
 * All text and style comes from src/brand.ts — edit there, not here.
 *
 * Props:
 *   mark    — render the compact monogram (e.g. collapsed sidebar)
 *   inverse — force light text (use on dark backgrounds, e.g. auth panel)
 *   className — controls height; width stays auto (e.g. "h-7")
 */
export function BrandLogo({
  className,
  inverse = false,
  mark = false,
}: {
  className?: string;
  inverse?: boolean;
  mark?: boolean;
}) {
  const base = "inline-flex select-none items-center leading-none";
  const color = inverse ? "text-white" : "text-foreground";
  const style = {
    fontFamily: BRAND.wordmarkFont,
    ...BRAND.wordmarkStyle,
  };

  if (mark) {
    return (
      <span
        style={style}
        aria-label={BRAND.name}
        className={cn(base, "justify-center text-2xl", color, className)}
      >
        {BRAND.monogram}
      </span>
    );
  }

  return (
    <span
      style={style}
      aria-label={BRAND.name}
      className={cn(base, "text-2xl", color, className)}
    >
      {BRAND.name}
    </span>
  );
}
