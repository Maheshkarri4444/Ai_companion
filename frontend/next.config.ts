import type { NextConfig } from "next";

/**
 * The browser only ever talks to this origin: `/api/*` is reverse-proxied to the Express API, so the
 * httpOnly session cookie is first-party (no third-party-cookie issues) and no CORS is needed.
 * BACKEND_URL is read when the config loads (build time on Vercel).
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev badge sits on top of the sidebar's account menu; errors still surface without it.
  devIndicators: false,
  experimental: {
    // With a proxy.ts present, Next buffers request bodies (default cap 10 MB, silently truncated beyond),
    // even for rewritten /api requests. Keep this above the API's MAX_UPLOAD_MB (20) + multipart overhead.
    proxyClientMaxBodySize: "25mb",
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
