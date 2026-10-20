import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { validateEnvironment } from "./scripts/runtime-environment.mjs";
import { commonSecurityHeaders, STATIC_CONTENT_SECURITY_POLICY } from "./src/server/security-headers.mjs";
export default function configureNext(phase) {
  validateEnvironment(process.env, {
    command: phase === PHASE_DEVELOPMENT_SERVER ? "dev" : "build",
    bindingHost: process.env.CHAGOKCHAN_BIND_HOST,
  });
  return {
    agentRules: false,
    poweredByHeader: false,
    reactStrictMode: true,
    async headers() {
      return [
        { source: "/", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }] },
        { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
        { source: "/offline.html", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
        { source: "/pwa-icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
        { source: "/:path*", headers: Object.entries({
          ...commonSecurityHeaders({ production: process.env.NODE_ENV === "production" }),
          "Content-Security-Policy": STATIC_CONTENT_SECURITY_POLICY,
        }).map(([key, value]) => ({ key, value })) },
      ];
    },
  };
}
