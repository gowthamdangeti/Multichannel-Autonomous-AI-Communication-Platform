import "./globals.css";

import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Inter, Playfair_Display } from "next/font/google";
import { Suspense } from "react";

import { BRAND } from "@/brand";
import ChatwootWidget from "@/components/ChatwootWidget";
import AppLayout from "@/components/layout/AppLayout";
import PostHogIdentify from "@/components/PostHogIdentify";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import SpinLoader from "@/components/SpinLoader";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/context/AppConfigContext";
import { DesignThemeProvider } from "@/context/DesignThemeContext";
import { FontFamilyProvider } from "@/context/FontFamilyContext";
import { HeaderProvider } from "@/context/HeaderContext";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { OrgConfigProvider } from "@/context/OrgConfigContext";
import { TelephonyConfigWarningsProvider } from "@/context/TelephonyConfigWarningsContext";
import { AuthProvider } from "@/lib/auth";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Per-design-theme display fonts (applied via [data-theme] in the theme CSS).
const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

// Picker-only UI font (Settings → Theme). Not preloaded: Geist is the default,
// and Inter is downloaded lazily the first time someone picks it.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {

  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${bricolageGrotesque.variable} ${playfairDisplay.variable} ${inter.variable}`}
      data-theme="monochrome"
      suppressHydrationWarning
    >
      <head>
        {/* Inline script to prevent flash of light theme / wrong design theme -
            runs before React hydrates. Dark is the locked default: only an
            explicit stored 'light' opts out. Monochrome is the default design
            theme: only an explicit stored value for one of the other four
            opts out. The UI font (data-font) follows the same pattern. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'light') {
                    document.documentElement.classList.remove('dark');
                  } else {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
                try {
                  var designTheme = localStorage.getItem('design-theme-v2');
                  var validThemes = ['monochrome', 'powder-blue', 'brutalist', 'minimalist', 'glassmorphism', 'modernism'];
                  if (designTheme && validThemes.indexOf(designTheme) !== -1) {
                    document.documentElement.setAttribute('data-theme', designTheme);
                  } else {
                    document.documentElement.setAttribute('data-theme', 'powder-blue');
                  }
                } catch (e) {
                  // data-theme="monochrome" from the server-rendered markup stands.
                }
                try {
                  var fontFamily = localStorage.getItem('font-family-v2');
                  var validFonts = ['system', 'geist', 'inter', 'playfair', 'bricolage'];
                  if (fontFamily && validFonts.indexOf(fontFamily) !== -1) {
                    document.documentElement.setAttribute('data-font', fontFamily);
                  }
                } catch (e) {
                  // No data-font → the default (Geist) stack applies.
                }
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <DesignThemeProvider>
            <FontFamilyProvider>
            <SentryErrorBoundary>
              <AuthProvider>
                <AppConfigProvider>
                  <Suspense fallback={<SpinLoader />}>
                    <OrgConfigProvider>
                      <TelephonyConfigWarningsProvider>
                        <OnboardingProvider>
                          <PostHogIdentify />
                          <HeaderProvider>
                            <AppLayout>
                              {children}
                            </AppLayout>
                          </HeaderProvider>
                          <Toaster />
                          <ChatwootWidget />
                        </OnboardingProvider>
                      </TelephonyConfigWarningsProvider>
                    </OrgConfigProvider>
                  </Suspense>
                </AppConfigProvider>
              </AuthProvider>
            </SentryErrorBoundary>
            </FontFamilyProvider>
          </DesignThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
