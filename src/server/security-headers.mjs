import { randomBytes } from "node:crypto";

export function commonSecurityHeaders({ production = false } = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...(production ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}

// A fresh nonce is generated on the server for each HTML request. Never trust a
// nonce or CSP sent by the caller. Supabase is accessed only through the BFF.
export function documentSecurityHeaders({ development = false } = {}) {
  const nonce = randomBytes(32).toString("base64");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self'${development ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    // React sets the numeric progress-bar width as a style attribute. This
    // exception permits styles only; inline scripts and event handlers remain blocked.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws://127.0.0.1:* ws://localhost:* ws://[::1]:*" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!development ? ["upgrade-insecure-requests"] : []),
  ];
  return { nonce, contentSecurityPolicy: directives.join("; ") };
}

// Public offline HTML has a fixed inline stylesheet and no executable scripts.
export const STATIC_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
