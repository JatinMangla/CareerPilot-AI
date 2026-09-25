const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` scripts: the App Router inlines its hydration payload, and a
 * nonce would force every page to render dynamically. `'unsafe-eval'`:
 * @react-pdf/renderer compiles its layout engine at runtime, and without it the
 * PDF buttons break. So this CSP is not an XSS wall — what it buys is the rest:
 * no framing (clickjacking), no plugins, no <base> hijack, forms and fetches only
 * to this origin, so injected script has nowhere to send what it reads.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // GitHub avatars on /github; data:/blob: for generated PDFs and previews.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The mock interview uses the camera and microphone; nothing else may.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Auto-Pilot and Apply Kits merged into /apply. Real HTTP redirects, so old
  // links and bookmarks work before any JavaScript runs.
  async redirects() {
    return [
      { source: "/autopilot", destination: "/apply?tab=pilot", permanent: false },
      { source: "/auto-apply", destination: "/apply?tab=kits", permanent: false },
    ];
  },
  serverExternalPackages: ["unpdf", "mammoth", "imapflow", "mailparser", "nodemailer"],
};

export default nextConfig;
