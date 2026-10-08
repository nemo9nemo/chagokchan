import { randomUUID } from "node:crypto";
import { ApiRequestError, validateMutationRequest } from "./api-security.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const NOTIFICATION_TYPES = new Set(["praise_received", "bunch_completed", "connection_requested", "connection_accepted"]);
const TARGET_KINDS = new Set(["praise", "bunch", "connection_request", "connection"]);

function exactObject(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => fields.includes(key));
}

function invalidInput() {
  throw new ApiRequestError(400, "INVALID_INPUT", "입력 형식이 올바르지 않습니다.");
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validTimestampOrNull(value) {
  return value === null || validTimestamp(value);
}

function validateId(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalidInput();
  return value;
}

function validatePageQuery(url) {
  const params = url.searchParams;
  if ([...params.keys()].some((key) => !["cursor", "limit"].includes(key)) || ["cursor", "limit"].some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && !CURSOR.test(cursor)) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if ((rawLimit !== null && !/^\d+$/.test(rawLimit)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  return { p_cursor: cursor, p_limit: limit };
}

function projectNotification(value) {
  const fields = ["id", "type", "created_at", "read_at", "target"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) ||
      !NOTIFICATION_TYPES.has(value.type) || !validTimestamp(value.created_at) || !validTimestampOrNull(value.read_at) ||
      !exactObject(value.target, ["kind", "id"]) || Object.keys(value.target).length !== 2 ||
      !TARGET_KINDS.has(value.target.kind) || !UUID.test(value.target.id)) {
    throw new Error("Notification response did not match its allowlist.");
  }
  return {
    id: value.id, type: value.type, created_at: value.created_at, read_at: value.read_at,
    target: { kind: value.target.kind, id: value.target.id },
  };
}

function projectSentPraise(value) {
  const fields = ["id", "source", "message", "recorded_at", "cancelled_at", "can_cancel"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) || value.source !== "peer" ||
      !(value.message === null || (typeof value.message === "string" && [...value.message].length <= 1000)) ||
      !validTimestamp(value.recorded_at) || !validTimestampOrNull(value.cancelled_at) || typeof value.can_cancel !== "boolean" ||
      (value.cancelled_at !== null && value.can_cancel)) {
    throw new Error("Sent praise response did not match its allowlist.");
  }
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function projectPage(value, itemProjector) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 || !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && CURSOR.test(value.next_cursor)))) {
    throw new Error("News page response did not match its allowlist.");
  }
  return { items: value.items.map(itemProjector), next_cursor: value.next_cursor };
}

function projectMutation(value, expectedId) {
  const fields = ["id", "replayed"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || value.id !== expectedId || !UUID.test(value.id) || typeof value.replayed !== "boolean") {
    throw new Error("Notification mutation response did not match its allowlist.");
  }
  return { id: value.id, replayed: value.replayed };
}

function jsonResponse(body, status, requestId) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId } });
}

function errorResponse(error, requestId) {
  if (error instanceof ApiRequestError) return jsonResponse({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status, requestId);
  const code = error && typeof error === "object" && "databaseCode" in error ? error.databaseCode : undefined;
  const databaseMessage = error && typeof error === "object" && "databaseMessage" in error ? error.databaseMessage : undefined;
  if (code === "PT400") return jsonResponse({ error: { code: "INVALID_INPUT", message: "입력 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  if (code === "PT401" || code === "PGRST301") return jsonResponse({ error: { code: "AUTH_REQUIRED", message: "현재 세션이 필요합니다.", request_id: requestId } }, 401, requestId);
  if (code === "PT403") return jsonResponse({ error: { code: "ACTION_FORBIDDEN", message: "요청을 수행할 수 없습니다.", request_id: requestId } }, 403, requestId);
  if (code === "PT404") return jsonResponse({ error: { code: "OBJECT_NOT_AVAILABLE", message: "요청한 항목을 찾을 수 없습니다.", request_id: requestId } }, 404, requestId);
  if (code === "PT409") return jsonResponse({ error: { code: "STATE_CONFLICT", message: "소식 상태가 바뀌었습니다. 목록을 다시 확인해 주세요.", request_id: requestId } }, 409, requestId);
  if (code === "PT429") return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요.", request_id: requestId } }, 429, requestId);
  if (databaseMessage === "dependency_unavailable") return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
  return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

function throwRpcError(error) {
  if (error) throw Object.assign(new Error("News request failed."), { databaseCode: error.code, databaseMessage: error.message });
}

async function listPage(url, client, rpc, project) {
  const requestId = randomUUID();
  try {
    const { data, error } = await client.rpc(rpc, validatePageQuery(url));
    throwRpcError(error);
    return jsonResponse(projectPage(data, project), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export function listNotificationsResponse(url, client) {
  return listPage(url, client, "list_notifications", projectNotification);
}

export function listSentPraisesResponse(url, client) {
  return listPage(url, client, "list_sent_praises", projectSentPraise);
}

export async function markNotificationReadResponse(notificationId, request, client, options = {}) {
  const requestId = randomUUID();
  try {
    const id = validateId(notificationId);
    const body = await validateMutationRequest(request, options);
    if (!exactObject(body, ["read"]) || Object.keys(body).length !== 1 || body.read !== true) invalidInput();
    const { data, error } = await client.rpc("mark_notification_read", { p_notification_id: id });
    throwRpcError(error);
    return jsonResponse(projectMutation(data, id), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}
