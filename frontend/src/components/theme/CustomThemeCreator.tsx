"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Sparkles,
  Palette,
  Check,
  RotateCcw,
  Sun,
  Moon,
  Copy,
  Sliders,
  Eye,
  ArrowRight,
  Bot,
  Zap,
  TrendingUp,
  Settings,
  LayoutGrid,
  ShieldAlert,
} from "lucide-react";

import { useDesignTheme } from "@/context/DesignThemeContext";
import { PREDEFINED_THEMES, DEFAULT_CUSTOM_THEME } from "@/lib/theme/predefined";
import { matchClosestTheme, parseColorToRgb } from "@/lib/theme/matcher";
import type { PredefinedThemeId, ThemeDefinition } from "@/types/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function toHex(val: number): string {
  const h = Math.max(0, Math.min(255, Math.round(val))).toString(16);
  return h.length === 1 ? "0" + h : h;
}

function ensureHexColor(colorStr: string): string {
  if (!colorStr) return "#000000";
  const str = colorStr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(str)) return str;
  if (/^#[0-9a-fA-F]{3}$/.test(str)) {
    return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`;
  }
  const rgb = parseColorToRgb(str);
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function CustomThemeCreator() {
  const {
    theme: activeTheme,
    setTheme,
    customTheme,
    saveCustomTheme,
    resetCustomTheme,
  } = useDesignTheme();

  // Working state for custom theme editing
  const [workingTheme, setWorkingTheme] = useState<ThemeDefinition>(customTheme);
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");
  const [editTab, setEditTab] = useState<"light" | "dark">("light");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // Sync working state when customTheme changes from storage
  useEffect(() => {
    setWorkingTheme(customTheme);
  }, [customTheme]);

  // Real-time similarity analysis to closest predefined theme
  const matchResult = useMemo(() => {
    return matchClosestTheme(workingTheme, previewMode);
  }, [workingTheme, previewMode]);

  // Color updates for current active edit tab (light or dark)
  const updateColor = (key: keyof typeof workingTheme.light, value: string) => {
    setWorkingTheme((prev) => {
      const targetMode = editTab;
      const updatedPalette = {
        ...prev[targetMode],
        [key]: value,
      };

      // Auto-mirror smart defaults if editing core colors
      if (key === "primary") {
        updatedPalette.ring = value;
        updatedPalette.sidebarPrimary = value;
        updatedPalette.cta = value;
      } else if (key === "background" && !prev[targetMode].sidebar) {
        updatedPalette.sidebar = value;
      }

      return {
        ...prev,
        [targetMode]: updatedPalette,
      };
    });
  };

  // Style updates (radius, shadows, borders)
  const updateStyle = (key: keyof typeof workingTheme.styles, value: string) => {
    setWorkingTheme((prev) => ({
      ...prev,
      styles: {
        ...prev.styles,
        [key]: value,
      },
    }));
  };

  // Load a predefined theme as starting baseline
  const loadPresetAsBase = (presetId: PredefinedThemeId) => {
    const preset = PREDEFINED_THEMES[presetId];
    if (preset) {
      setWorkingTheme({
        id: "custom",
        name: `Custom (${preset.name} Base)`,
        description: `Customized theme inspired by ${preset.name}`,
        light: { ...preset.light },
        dark: { ...preset.dark },
        styles: { ...preset.styles },
      });
    }
  };

  // Apply custom theme globally
  const handleSaveAndApply = () => {
    saveCustomTheme(workingTheme);
    setTheme("custom");
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  // Export JSON to clipboard
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(workingTheme, null, 2));
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
  };

  // Current palette for UI preview mockup
  const previewPalette = previewMode === "light" ? workingTheme.light : workingTheme.dark;
  const previewStyles = workingTheme.styles;

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card/60 p-6 shadow-sm backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-4 w-4" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Custom Theme Studio
            </h2>
            <Badge variant="outline" className="border-primary/30 text-primary">
              Live Engine
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure platform color tokens and geometry with live similarity matching to predefined presets.
          </p>
        </div>

        {/* Global Save Button */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyJson}
            className="gap-1.5 text-xs"
          >
            {copiedSuccess ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSuccess ? "Copied JSON" : "Export JSON"}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleSaveAndApply}
            className="gap-1.5 shadow-sm transition-all"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4 text-primary-foreground" />
                Theme Applied!
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Apply Custom Theme Globally
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Preset Starters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Start from preset:
        </span>
        {Object.entries(PREDEFINED_THEMES).map(([id, preset]) => (
          <button
            key={id}
            type="button"
            onClick={() => loadPresetAsBase(id as PredefinedThemeId)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span
              className="h-2.5 w-2.5 rounded-full border border-black/20"
              style={{ backgroundColor: preset.light.primary }}
            />
            {preset.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            resetCustomTheme();
            setWorkingTheme(DEFAULT_CUSTOM_THEME);
          }}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      {/* AI Color Matching Banner */}
      <div className="relative overflow-hidden rounded-xl border-2 border-primary/20 bg-primary/5 p-4 transition-all">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Nearest Predefined Match
              </span>
              <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                {matchResult.closestThemeName} ({matchResult.similarity}% Match)
              </Badge>
            </div>
            <p className="text-xs text-foreground/80">{matchResult.reasoning}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(matchResult.closestTheme)}
              className="h-8 gap-1 border-primary/30 text-xs text-primary hover:bg-primary/10"
            >
              Switch to {matchResult.closestThemeName}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Match Breakdown Progress Bars */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-primary/10 pt-3 sm:grid-cols-5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Primary</span>
              <span className="font-semibold text-foreground">{matchResult.breakdown.primaryMatch}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${matchResult.breakdown.primaryMatch}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Background</span>
              <span className="font-semibold text-foreground">{matchResult.breakdown.backgroundMatch}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${matchResult.breakdown.backgroundMatch}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Surfaces</span>
              <span className="font-semibold text-foreground">{matchResult.breakdown.surfaceMatch}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${matchResult.breakdown.surfaceMatch}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Accent</span>
              <span className="font-semibold text-foreground">{matchResult.breakdown.accentMatch}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${matchResult.breakdown.accentMatch}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Borders</span>
              <span className="font-semibold text-foreground">{matchResult.breakdown.borderMatch}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${matchResult.breakdown.borderMatch}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Left Controls / Right Live UI Preview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Color & Style Pickers */}
        <div className="space-y-5 lg:col-span-5">
          {/* Mode Switcher for Editing */}
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setEditTab("light")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  editTab === "light"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sun className="h-3.5 w-3.5 text-amber-500" />
                Light Palette
              </button>
              <button
                type="button"
                onClick={() => setEditTab("dark")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  editTab === "dark"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Moon className="h-3.5 w-3.5 text-indigo-400" />
                Dark Palette
              </button>
            </div>

            <div className="text-xs text-muted-foreground">
              Editing: <span className="font-medium capitalize text-foreground">{editTab}</span>
            </div>
          </div>

          {/* Color Inputs */}
          <div className="grid grid-cols-2 gap-3.5">
            {/* Primary */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Primary Brand</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].primary)}
                  onChange={(e) => updateColor("primary", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].primary}
                  onChange={(e) => updateColor("primary", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Background */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Background Canvas</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].background)}
                  onChange={(e) => updateColor("background", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].background}
                  onChange={(e) => updateColor("background", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Card / Surface */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Card Surfaces</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].card)}
                  onChange={(e) => updateColor("card", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].card}
                  onChange={(e) => updateColor("card", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Sidebar Background</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].sidebar)}
                  onChange={(e) => updateColor("sidebar", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].sidebar}
                  onChange={(e) => updateColor("sidebar", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Accent */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Accent / Secondary</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].accent)}
                  onChange={(e) => updateColor("accent", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].accent}
                  onChange={(e) => updateColor("accent", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Border */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Border Outline</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].border)}
                  onChange={(e) => updateColor("border", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].border}
                  onChange={(e) => updateColor("border", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Foreground / Text */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Typography Text</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].foreground)}
                  onChange={(e) => updateColor("foreground", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].foreground}
                  onChange={(e) => updateColor("foreground", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* Destructive */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Destructive / Alert</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ensureHexColor(workingTheme[editTab].destructive)}
                  onChange={(e) => updateColor("destructive", e.target.value)}
                  className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  value={workingTheme[editTab].destructive}
                  onChange={(e) => updateColor("destructive", e.target.value)}
                  className="h-8 font-mono text-xs uppercase"
                />
              </div>
            </div>
          </div>

          {/* Geometry & Surface Sliders */}
          <div className="space-y-3.5 border-t border-border pt-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sliders className="h-3.5 w-3.5" />
              Geometry & Spatial Styles
            </div>

            {/* Radius Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-foreground">Corner Radius</span>
                <span className="font-mono text-muted-foreground">{workingTheme.styles.radius}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.125"
                  value={parseFloat(workingTheme.styles.radius)}
                  onChange={(e) => {
                    const r = `${e.target.value}rem`;
                    updateStyle("radius", r);
                    updateStyle("radiusCard", r);
                    updateStyle("radiusSidebar", r);
                  }}
                  className="h-1.5 w-full cursor-pointer accent-primary"
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0rem (Sharp)</span>
                <span>0.625rem</span>
                <span>1.5rem (Pill)</span>
              </div>
            </div>

            {/* Border Width & Shadow Presets */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Border Width</label>
                <div className="flex gap-1.5">
                  {["1px", "1.5px", "2px"].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => updateStyle("surfaceBorderWidth", w)}
                      className={cn(
                        "flex-1 rounded-md border py-1 text-xs font-medium transition-colors",
                        workingTheme.styles.surfaceBorderWidth === w
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Shadow Elevation</label>
                <div className="flex gap-1.5">
                  {[
                    { label: "None", val: "none" },
                    { label: "Soft", val: "0 1px 3px rgba(0,0,0,0.1)" },
                    { label: "Hard", val: "3px 3px 0 0 #000000" },
                  ].map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => updateStyle("surfaceShadow", s.val)}
                      className={cn(
                        "flex-1 rounded-md border py-1 text-xs font-medium transition-colors",
                        workingTheme.styles.surfaceShadow === s.val
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Interactive UI Preview */}
        <div className="flex flex-col space-y-3 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Interactive UI Preview
            </div>

            {/* Preview Light/Dark Mode Toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setPreviewMode("light")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  previewMode === "light"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sun className="h-3 w-3 text-amber-500" />
                Light Mode
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode("dark")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  previewMode === "dark"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Moon className="h-3 w-3 text-indigo-400" />
                Dark Mode
              </button>
            </div>
          </div>

          {/* Preview Canvas Container */}
          <div
            className="flex flex-1 flex-col overflow-hidden border transition-all duration-200"
            style={{
              backgroundColor: previewPalette.background,
              color: previewPalette.foreground,
              borderColor: previewPalette.border,
              borderRadius: previewStyles.radius,
              borderWidth: previewStyles.surfaceBorderWidth,
              boxShadow: previewStyles.surfaceShadow,
            }}
          >
            {/* Mock Header */}
            <header
              className="flex items-center justify-between border-b px-4 py-2.5"
              style={{
                backgroundColor: previewPalette.card,
                borderColor: previewPalette.border,
                borderBottomWidth: previewStyles.surfaceBorderWidth,
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-md font-bold text-xs"
                  style={{
                    backgroundColor: previewPalette.primary,
                    color: previewPalette.primaryForeground,
                  }}
                >
                  AI
                </div>
                <span className="text-xs font-bold tracking-tight">Autonomous AI OS</span>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: previewPalette.accent,
                    color: previewPalette.accentForeground,
                  }}
                >
                  ● System Operational
                </div>
                <div
                  className="h-6 w-6 rounded-full border"
                  style={{
                    backgroundColor: previewPalette.muted,
                    borderColor: previewPalette.border,
                  }}
                />
              </div>
            </header>

            {/* Mock Body: Sidebar + Main Content */}
            <div className="flex flex-1">
              {/* Mini Sidebar */}
              <aside
                className="w-28 border-r p-2.5 space-y-1.5"
                style={{
                  backgroundColor: previewPalette.sidebar,
                  borderColor: previewPalette.sidebarBorder,
                  borderRightWidth: previewStyles.surfaceBorderWidth,
                }}
              >
                <div
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium"
                  style={{
                    backgroundColor: previewPalette.sidebarAccent,
                    color: previewPalette.sidebarAccentForeground,
                  }}
                >
                  <Bot className="h-3 w-3" />
                  Agents
                </div>
                <div
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium opacity-70"
                  style={{ color: previewPalette.sidebarForeground }}
                >
                  <LayoutGrid className="h-3 w-3" />
                  Workflows
                </div>
                <div
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium opacity-70"
                  style={{ color: previewPalette.sidebarForeground }}
                >
                  <TrendingUp className="h-3 w-3" />
                  Analytics
                </div>
                <div
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium opacity-70"
                  style={{ color: previewPalette.sidebarForeground }}
                >
                  <Settings className="h-3 w-3" />
                  Settings
                </div>
              </aside>

              {/* Main Content Area */}
              <main className="flex-1 p-3.5 space-y-3">
                {/* Title & Action */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold">Autonomous Agents Hub</h3>
                    <p className="text-[10px] opacity-70">32 multi-modal agents active</p>
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-transform active:scale-95"
                    style={{
                      backgroundColor: previewPalette.primary,
                      color: previewPalette.primaryForeground,
                      borderRadius: previewStyles.radiusButton,
                      boxShadow: previewStyles.buttonShadow,
                    }}
                  >
                    <Zap className="h-3 w-3" />
                    Deploy Agent
                  </button>
                </div>

                {/* 3 Metric Cards */}
                <div className="grid grid-cols-3 gap-2">
                  <div
                    className="p-2 border"
                    style={{
                      backgroundColor: previewPalette.card,
                      borderColor: previewPalette.border,
                      borderRadius: previewStyles.radiusCard,
                      borderWidth: previewStyles.surfaceBorderWidth,
                      boxShadow: previewStyles.surfaceShadowSm,
                    }}
                  >
                    <span className="text-[10px] opacity-70">Active Runs</span>
                    <div className="text-sm font-bold">142</div>
                    <span className="text-[9px] text-green-500 font-medium">+18% today</span>
                  </div>

                  <div
                    className="p-2 border"
                    style={{
                      backgroundColor: previewPalette.card,
                      borderColor: previewPalette.border,
                      borderRadius: previewStyles.radiusCard,
                      borderWidth: previewStyles.surfaceBorderWidth,
                      boxShadow: previewStyles.surfaceShadowSm,
                    }}
                  >
                    <span className="text-[10px] opacity-70">Success Rate</span>
                    <div className="text-sm font-bold">99.4%</div>
                    <span className="text-[9px] opacity-70">Autonomous verif.</span>
                  </div>

                  <div
                    className="p-2 border"
                    style={{
                      backgroundColor: previewPalette.card,
                      borderColor: previewPalette.border,
                      borderRadius: previewStyles.radiusCard,
                      borderWidth: previewStyles.surfaceBorderWidth,
                      boxShadow: previewStyles.surfaceShadowSm,
                    }}
                  >
                    <span className="text-[10px] opacity-70">Avg Latency</span>
                    <div className="text-sm font-bold">240ms</div>
                    <span className="text-[9px] text-green-500 font-medium">Real-time STT</span>
                  </div>
                </div>

                {/* Sample Agent List Item */}
                <div
                  className="flex items-center justify-between p-2.5 border"
                  style={{
                    backgroundColor: previewPalette.card,
                    borderColor: previewPalette.border,
                    borderRadius: previewStyles.radiusCard,
                    borderWidth: previewStyles.surfaceBorderWidth,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-7 w-7 rounded flex items-center justify-center font-bold text-xs"
                      style={{
                        backgroundColor: previewPalette.accent,
                        color: previewPalette.accentForeground,
                        borderRadius: previewStyles.radiusBadge,
                      }}
                    >
                      <Bot className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold">Master Orchestrator</div>
                      <div className="text-[10px] opacity-70">LangGraph • Hybrid routing</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{
                        backgroundColor: previewPalette.accent,
                        color: previewPalette.accentForeground,
                        borderRadius: previewStyles.radiusBadge,
                      }}
                    >
                      Active
                    </span>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        borderColor: previewPalette.border,
                        color: previewPalette.foreground,
                        borderRadius: previewStyles.radiusButton,
                      }}
                    >
                      Manage
                    </button>
                  </div>
                </div>

                {/* Form Controls Preview (Input & Buttons) */}
                <div className="flex items-center gap-2 pt-1">
                  <div
                    className="flex-1 rounded border px-2 py-1 text-[11px] opacity-80"
                    style={{
                      backgroundColor: previewPalette.input,
                      borderColor: previewPalette.border,
                      color: previewPalette.foreground,
                      borderRadius: previewStyles.radiusInput,
                    }}
                  >
                    Enter natural-language objective...
                  </div>
                  <button
                    type="button"
                    className="rounded px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      backgroundColor: previewPalette.secondary,
                      color: previewPalette.secondaryForeground,
                      borderRadius: previewStyles.radiusButton,
                    }}
                  >
                    Secondary
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      backgroundColor: previewPalette.destructive,
                      color: previewPalette.destructiveForeground,
                      borderRadius: previewStyles.radiusButton,
                    }}
                  >
                    <ShieldAlert className="h-3 w-3" />
                    Halt
                  </button>
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
