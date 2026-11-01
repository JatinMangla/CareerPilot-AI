import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy, built per request around a nonce.
 *
 * Scripts need the nonce, so an injected <script> or inline handler does not run.
 * This is the wall that matters here: script running in this origin could read the
 * synced state and send mail as you, because the session cookie is only safe from
 * being read, not from being used. It costs a server render per page, which is
 * negligible when this proxy already runs on every page.
 *
 * `'wasm-unsafe-eval'` is for @react-pdf's layout engine, which compiles
 * WebAssembly. It used to be `'unsafe-eval'`, which also allows eval() of strings.
 * Development needs that for Turbopack's refresh, and nothing else does.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // GitHub avatars on /github; data:/blob: for generated PDFs and previews.
    // Not https: at large — an image URL is a way to send data out, and connect-src
    // does not cover it.
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    // data: because the PDF engine fetches its bundled WebAssembly from a data URL.
    // That fetch stays on the device, so it cannot carry anything out.
    "connect-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Passes the request on with a CSP Next can read the nonce from. */
function withCsp(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  // Next finds the nonce here and stamps it on every script it renders.
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

/**
 * Route gate (Next 16 renamed middleware to proxy; it now runs on Node.js).
 * Signature, age and owner only — revocation is checked by requireSession() in
 * the data routes, where a Redis round trip is worth paying.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // public paths
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return withCsp(req);
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Back to the page you asked for. Only a path on this site: the login page
    // refuses anything else, so this cannot become an open redirect.
    if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return withCsp(req);
}

export const config = {
  // The icon and manifest stay public: a phone fetches them with no session when
  // the app is added to the home screen.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
