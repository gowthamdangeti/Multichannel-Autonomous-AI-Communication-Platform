# Theme Design System — Rules & Conventions

## Architecture

```
globals.css
  ├── themes/common.css       ← :root + .dark (default values = Brutalist)
  ├── themes/brutalist.css    ← component overrides + variable block
  ├── themes/minimalist.css   ← [data-theme="minimalist"] overrides
  ├── themes/glassmorphism.css ← [data-theme="glassmorphism"] overrides
  ├── themes/modernism.css    ← [data-theme="modernism"] overrides
  └── themes/monochrome.css   ← [data-theme="monochrome"] overrides (default theme)
```

- `common.css` is the **single source of truth** for ALL CSS custom properties
- Each theme file **only overrides** the values that differ from common.css defaults
- Theme selectors use `[data-theme="<name>"]` (light) and `[data-theme="<name>"].dark` (dark)

---

## Golden Rules

### 1. Never hardcode color/layout values in component overrides

```css
/* ❌ BAD — hardcoded hex */
background-color: #ed356d;

/* ✅ GOOD — use a CSS variable */
background-color: var(--cta);
```

### 2. Every variable must be defined in common.css first

Before adding a `var(--xyz)` reference anywhere, add it to `common.css` (`:root` for light, `.dark` for dark):

```css
/* In common.css :root */
--my-new-token: #somevalue;

/* Also in common.css .dark if it changes in dark mode */
--my-new-token: #darkmodevalue;
```

### 3. Theme files must use `[data-theme="..."]` selector

```css
/* ✅ CORRECT */
[data-theme="minimalist"] {
  --background: oklch(...);
}

/* ❌ WRONG — use [data-theme="..."] instead of bare :root for theme files */
```

### 4. One theme file = one set of variable overrides

Each theme file only defines the subset of variables that differ from common.css. Never repeat values that match the default.

### 5. Dark mode uses `.dark` class + theme attribute

```css
/* ✅ CORRECT — higher specificity beats bare .dark */
[data-theme="glassmorphism"].dark {
  --background: oklch(...);
}
```

### 6. Component override rules must be scoped to the theme

```css
/* ✅ CORRECT */
[data-theme="brutalist"] [data-slot="card"] { ... }

/* ❌ WRONG — affects all themes */
[data-slot="card"] { ... }
```

### 7. Brand Color Consistency

The brand color is strictly **Pink** (e.g., `#ff2a75`, `oklch(0.62 0.22 9)`).
- When creating ambient gradients, meshes, or theme accents, you must exclusively use shades of pink, rose, magenta, or peach.
- **Do not** introduce other hues (e.g., blue, green, indigo, purple) unless explicitly requested.
- Monochrome is the requested exception: neutral UI surfaces, with colour limited to brand, `--status-*` and the `--chart-*` data palette.

---

## Variable Categories

| Group | Prefix | Example |
|---|---|---|
| Core palette | `--background`, `--foreground`, `--card`, ... | `--background: #ffffff` |
| Semantic | `--primary`, `--secondary`, `--muted`, `--accent`, ... | `--primary: #2b2b2b` |
| Surface | `--surface-shadow`, `--surface-blur`, `--surface-border-width` | `--surface-blur: 0px` |
| Radius | `--radius`, `--radius-card`, `--radius-button`, ... | `--radius: 0.625rem` |
| Sidebar | `--sidebar`, `--sidebar-foreground`, ... | `--sidebar: #ffffff` |
| Charts | `--chart-1` through `--chart-5`, `--chart-grid`, `--chart-line` | `--chart-1: #ed356d` |
| Brand | `--cta`, `--cta-foreground`, `--brand-imprint` | `--cta: #2b2b2b` |
| Pink accent | `--pink-50/100/200/300`, `--accent-pink`, `--accent-pink-foreground` | `--pink-50: #fff7f9` |
| Text | `--text-body`, `--text-description`, `--text-muted` | `--text-body: #222222` |

---

## Adding a New Theme

1. Create `themes/<name>.css`
2. Use `[data-theme="<name>"]` for light values
3. Use `[data-theme="<name>"].dark` for dark values
4. Only define variables that differ from common.css defaults
5. Import in `globals.css` (after common.css)
6. Use `data-theme="<name>"` attribute on `<html>` to activate

---

## Removing a Variable

1. Search the entire codebase for `var(--<name>)` — if zero results, it's safe to remove
2. Remove from common.css (`:root` and `.dark`)
3. Remove from all theme files where it appears

---

## Production Checklist

- [ ] Every `var(--x)` reference has a corresponding definition in common.css
- [ ] No duplicate variable definitions across theme files
- [ ] Theme files use `[data-theme="..."]` selectors, never bare `:root` or `.dark`
- [ ] No hardcoded color values in component override rules
- [ ] Dark mode variables are defined when the value differs from light mode
- [ ] New themes are imported in globals.css before they're activated
