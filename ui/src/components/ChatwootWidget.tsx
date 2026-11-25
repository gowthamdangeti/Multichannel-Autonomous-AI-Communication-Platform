"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    chatwootSDK?: {
      run: (config: {
        websiteToken: string;
        baseUrl: string;
      }) => void;
    };
    chatwootSettings?: {
      position?: "left" | "right";
      type?: "standard" | "expanded_bubble";
      launcherTitle?: string;
    };
  }
}

// Chatwoot's website token is a *public* client token — it is designed to be
// embedded in the browser widget and is not a secret. Do not put a private
// Chatwoot API/agent token in a NEXT_PUBLIC_ variable.
const CHATWOOT_BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_URL?.trim() || "";
const CHATWOOT_WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_TOKEN?.trim() || "";

// Chatwoot is optional: when both variables are unset it is intentionally
// disabled and the widget stays silent. Warn only when the configuration is
// half-present, which is almost always a mistake.
const CHATWOOT_CONFIGURED = Boolean(CHATWOOT_BASE_URL && CHATWOOT_WEBSITE_TOKEN);

export default function ChatwootWidget() {
  const pathname = usePathname();

  useEffect(() => {
    const isWorkflowPage = /^\/(?:workflow|voice\/agents|voiceagents)\/[^/]+(?:\/.*)?$/.test(pathname);

    if (isWorkflowPage) {
      if (CHATWOOT_CONFIGURED) {
        document.getElementById("cw-widget-holder")?.remove();
        document.getElementById("cw-bubble-holder")?.remove();
        document.getElementById("cw-widget-styles")?.remove();
        document
          .querySelector(`script[src="${CHATWOOT_BASE_URL}/packs/js/sdk.js"]`)
          ?.remove();
        delete window.chatwootSettings;
      }
      return;
    }

    // Chatwoot intentionally disabled (both variables unset) — nothing to do.
    if (!CHATWOOT_CONFIGURED) {
      // Surface a misconfiguration (only one of the two variables set) so it is
      // not mistaken for an intentionally disabled integration.
      if (Boolean(CHATWOOT_BASE_URL) !== Boolean(CHATWOOT_WEBSITE_TOKEN)) {
        console.warn(
          "Chatwoot is partially configured: set both NEXT_PUBLIC_CHATWOOT_URL and NEXT_PUBLIC_CHATWOOT_TOKEN, or neither to disable it."
        );
      }
      return;
    }

    // Prevent duplicate initialization
    if (window.chatwootSettings) {
      return;
    }

    // Configure Chatwoot widget settings
    window.chatwootSettings = {
      position: "right",
      type: "standard",
      launcherTitle: "Chat with us",
    };

    // Check if script is already loaded
    const existingScript = document.querySelector(
      `script[src="${CHATWOOT_BASE_URL}/packs/js/sdk.js"]`
    );

    if (existingScript) {
      // Script already exists, just initialize if SDK is available
      if (window.chatwootSDK) {
        window.chatwootSDK.run({
          websiteToken: CHATWOOT_WEBSITE_TOKEN,
          baseUrl: CHATWOOT_BASE_URL,
        });
      }
      return;
    }

    // Create and inject the Chatwoot SDK script
    const script = document.createElement("script");
    script.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.chatwootSDK) {
        window.chatwootSDK.run({
          websiteToken: CHATWOOT_WEBSITE_TOKEN,
          baseUrl: CHATWOOT_BASE_URL,
        });
      }
    };

    document.body.appendChild(script);
  }, [pathname]);

  return null;
}
