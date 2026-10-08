import "server-only";
import { markNotificationReadResponse } from "@/server/news-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ notification_id: string }> }) {
  const { notification_id: notificationId } = await context.params;
  return withLocalSession((client) => markNotificationReadResponse(notificationId, request, client, {
    expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin,
  }));
}
