import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  experimental: {
    serverSourceMaps: process.env.NODE_ENV === 'production',
  },
  async redirects() {
    return [
      {
        source: "/workflow",
        destination: "/voice/agents",
        permanent: false,
      },
      {
        source: "/workflow/:path*",
        destination: "/voice/agents/:path*",
        permanent: false,
      },
      {
        source: "/voiceagents",
        destination: "/voice/agents",
        permanent: false,
      },
      {
        source: "/voiceagents/:path*",
        destination: "/voice/agents/:path*",
        permanent: false,
      },
      {
        source: "/usage",
        destination: "/voice/conversations",
        permanent: false,
      },
      {
        source: "/usage/:path*",
        destination: "/voice/conversations/:path*",
        permanent: false,
      },
      {
        source: "/voiceconversation",
        destination: "/voice/conversations",
        permanent: false,
      },
      {
        source: "/voiceconversation/:path*",
        destination: "/voice/conversations/:path*",
        permanent: false,
      },
    ];
  },

  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    const miniUrl = process.env.MINI_URL || 'http://localhost:9000';
    return [
      {
        source: "/voice/agents",
        destination: "/workflow",
      },
      {
        source: "/voice/agents/:path*",
        destination: "/workflow/:path*",
      },
      {
        source: "/voice/conversations",
        destination: "/usage",
      },
      {
        source: "/voice/conversations/:path*",
        destination: "/usage/:path*",
      },
      {
        source: "/voiceagents",
        destination: "/workflow",
      },
      {
        source: "/voiceagents/:path*",
        destination: "/workflow/:path*",
      },
      {
        source: "/voiceconversation",
        destination: "/usage",
      },
      {
        source: "/voiceconversation/:path*",
        destination: "/usage/:path*",
      },

      // Proxy backend API calls through Next.js — backend stays private, never exposed publicly.
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },

      // Proxy Mini calls
      {
        source: "/voice-audio/:path*",
        destination: `${miniUrl}/voice-audio/:path*`,
      },

      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "convozent",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
