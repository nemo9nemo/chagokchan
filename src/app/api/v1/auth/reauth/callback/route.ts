import "server-only";
import { reauthCallbackResponse } from "@/server/account-deletion-api.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return reauthCallbackResponse(request); }
