import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerBackendUrl } from '@/lib/apiClient';

const OSS_TOKEN_COOKIE = 'ai_os_auth_token';

// Paths that don't require authentication in OSS mode
const PUBLIC_PATHS = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/voice-audio', '/smoke-select'];

// TTL-based cache for auth provider to avoid blocking every navigation
const AUTH_CACHE_TTL_MS = 60_000; // 60 seconds
let cachedAuthProvider: string | null = null;
let cacheTimestamp = 0;

// Timeout for the health check fetch — prevents hanging if backend is slow
const HEALTH_FETCH_TIMEOUT_MS = 5_000;

async function fetchAuthProvider(): Promise<string> {
  const now = Date.now();
  if (cachedAuthProvider && now - cacheTimestamp < AUTH_CACHE_TTL_MS) {
    return cachedAuthProvider;
  }

  try {
    const backendUrl = getServerBackendUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS);
    const res = await fetch(`${backendUrl}/api/v1/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      cachedAuthProvider = (data.auth_provider as string) || 'local';
      cacheTimestamp = now;
      return cachedAuthProvider;
    }
  } catch {
    // Backend not reachable or timed out — fall through without caching so we retry next request.
  }

  // Provider unknown (backend unreachable). Return a non-'local' sentinel so the
  // middleware does NOT guard/redirect: assuming 'local' here would bounce Stack
  // users to /auth/login. Deliberately not cached — the next request retries.
  return 'unknown';
}

export async function middleware(request: NextRequest) {
  const authProvider = await fetchAuthProvider();

  // Only handle OSS mode
  if (authProvider !== 'local') {
    return NextResponse.next();
  }

  const token = request.cookies.get(OSS_TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Allow public paths without auth
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // If no token, redirect to login
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - voice-audio (public audio/transcript files)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - embed (public widget assets, loaded cross-origin without auth)
     * - public static assets (anything with a file extension, e.g. /icon.svg)
     */
    '/((?!api|voice-audio|_next/static|_next/image|embed|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)).*)',
  ],
};
