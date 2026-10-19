import "server-only";
import { randomUUID } from "node:crypto";
import { getVerifiedAuthContext } from "@/server/app-session";
import { authContextResponse } from "@/server/registration-api.mjs";
import { authRequiredResponse, sessionFailureResponse } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getVerifiedAuthContext();
    if (!context) return authRequiredResponse();
    return await authContextResponse(context.client, context.userId);
  } catch (error) { return sessionFailureResponse(error, randomUUID()); }
}
