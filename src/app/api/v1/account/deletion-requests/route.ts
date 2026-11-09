import "server-only";
import { accountDeletionResponse } from "@/server/account-deletion-api.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return accountDeletionResponse(request); }
