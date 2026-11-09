import "server-only";
import { refreshResponse } from "@/server/web-auth-api.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return refreshResponse(request); }
