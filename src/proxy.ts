import { type NextRequest, NextResponse } from "next/server";
import { documentSecurityHeaders } from "@/server/security-headers.mjs";

export function proxy(request: NextRequest) {
  const { nonce, contentSecurityPolicy } = documentSecurityHeaders({ development: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|pwa-icons(?:/|$)|sw\\.js$|offline\\.html$|manifest\\.webmanifest$|favicon\\.ico$).*)"],
};
