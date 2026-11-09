import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import policy from "../../policies/app-policy.json";
import { openSession, resolveVerifiedAuthSession, sessionCookieValue } from "@/server/deployed-session.mjs";
import { authContextResponse } from "@/server/registration-api.mjs";
import AuthScreen from "./auth-screen";
import ChagokchanApp from "./client-app";
import SessionBoundary from "./session-boundary";

export default async function AuthGate({ destination = "/" }: { destination?: "/" | "/connect" | "/signup" | "/account/deletion" }) {
  if (process.env.APP_AUTH_MODE === "local_fixture") return <ChagokchanApp />;
  const store = await cookies();
  const header = store.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  let state: "active" | "signup_required" | "deleting";
  let userId: string;
  try {
    const verified = await resolveVerifiedAuthSession(header);
    if (!verified) return <AuthScreen mode={openSession(sessionCookieValue(header)) ? "refresh" : "login"} next={destination === "/connect" ? "/connect" : "/"} />;
    const result = await authContextResponse(verified.client, verified.userId);
    if (result.status === 401) return <AuthScreen mode="refresh" />;
    if (!result.ok) return <AuthScreen mode="unavailable" />;
    state = (await result.json()).account_state;
    userId = verified.userId;
  } catch { return <AuthScreen mode="unavailable" />; }
  if (state === "signup_required") return <AuthScreen mode="signup" policyVersion={policy.policy_version} />;
  if (state === "deleting") return <AuthScreen mode="deleting" />;
  if (destination === "/signup" || destination === "/account/deletion") redirect("/");
  return <SessionBoundary userId={userId}><ChagokchanApp deployedAuth /></SessionBoundary>;
}
