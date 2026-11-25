"use client";

// Animated grain-gradient background for the auth brand panel (WebGL shader
// from @paper-design/shaders-react): soft, grainy colour blooming in from the
// corners over the panel's black surface. Decorative only — if WebGL is
// unavailable the panel's own --auth-panel-surface shows instead.
//
// The shader takes literal colour strings (it cannot read CSS variables), so
// the palette lives here: white plus the monochrome theme's rose accent
// (same value as --sidebar-selected in themes/monochrome.css).

import { GrainGradient } from "@paper-design/shaders-react";

const SHADER_COLORS = ["#ffffff", "#ba3f61", "#ba3f61", "#ffffff"];

export function AuthPanelShader() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <GrainGradient
        speed={1}
        scale={1}
        rotation={0}
        offsetX={0}
        offsetY={0}
        softness={0.5}
        intensity={0.5}
        noise={0.25}
        shape="corners"
        frame={2854.5}
        colors={SHADER_COLORS}
        colorBack="#00000000"
        className="absolute inset-0"
      />
    </div>
  );
}
