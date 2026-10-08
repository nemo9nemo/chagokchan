import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { validateEnvironment } from "./scripts/runtime-environment.mjs";
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
      return [{ source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ] }];
    },
  };
}
