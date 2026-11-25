"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getBackendApiUrl } from "@/lib/apiClient";

interface GoogleSignInButtonProps {
  text?: "signin_with" | "signup_with" | "continue_with";
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: string;
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number | string;
              logo_alignment?: "left" | "center";
            }
          ) => void;
        };
      };
    };
  }
}

const DEFAULT_CLIENT_ID =
  "599694116769-vftfi1e4bskfmfuu4u49v24hfop3m4p3.apps.googleusercontent.com";

export function GoogleSignInButton({ text = "continue_with" }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;

  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      if (!response.credential) return;
      setLoading(true);
      try {
        const baseUrl = getBackendApiUrl();
        const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        });

        const data = await res.json();
        if (!res.ok || !data.token) {
          toast.error(data.detail || "Google authentication failed");
          return;
        }

        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data.token, user: data.user }),
        });

        toast.success("Signed in successfully!");
        window.location.href = "/after-sign-in";
      } catch (err) {
        console.error("Google sign in error:", err);
        toast.error("Failed to sign in with Google. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const renderGoogleButton = useCallback(() => {
    if (typeof window !== "undefined" && window.google?.accounts?.id && containerRef.current) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      });

      containerRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text,
        shape: "rectangular",
      });
    }
  }, [clientId, handleCredentialResponse, text]);

  useEffect(() => {
    renderGoogleButton();
  }, [renderGoogleButton]);

  return (
    <div className="w-full flex flex-col items-center justify-center my-3">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={renderGoogleButton}
      />
      <div ref={containerRef} className="flex justify-center w-full min-h-[44px]" />
      {loading && (
        <p className="text-xs text-muted-foreground mt-2 animate-pulse">
          Authenticating with Google...
        </p>
      )}
    </div>
  );
}

