const isDev = process.env.NODE_ENV !== "production";

// The Content-Security-Policy is set in proxy.ts: it carries a per-request nonce,
// which a static header cannot.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Applications open with noopener, so nothing needs a window reference to this page.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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
