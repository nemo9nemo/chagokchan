import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const AVATARS = new Set(["grape", "leaf", "star"]);
const CONNECTION_STATUSES = new Set(["active", "inactive"]);
const REQUEST_DIRECTIONS = new Set(["incoming", "outgoing"]);
const REQUEST_STATUSES = new Set(["pending", "accepted", "rejected", "cancelled", "expired"]);

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

function validatePageQuery(url, options = {}) {
  const allowed = options.direction ? ["cursor", "limit", "direction"] : ["cursor", "limit"];
  const params = url.searchParams;
  if ([...params.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && !CURSOR.test(cursor)) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if ((rawLimit !== null && !/^\d+$/.test(rawLimit)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  let direction;
  if (options.direction) {
    const requestedDirection = params.get("direction");
    if (requestedDirection !== null && !REQUEST_DIRECTIONS.has(requestedDirection)) invalidInput();
    direction = requestedDirection ?? "both";
  }
  return { p_cursor: cursor, p_limit: limit, ...(options.direction ? { p_direction: direction } : {}) };
}

export function validateInviteSecret(value) {
  if (!exactObject(value, ["link_token", "code"]) || Object.keys(value).length !== 1) invalidInput();
  if (Object.hasOwn(value, "link_token")) {
    if (typeof value.link_token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.link_token)) invalidInput();
    return { link_token: value.link_token };
  }
  if (typeof value.code !== "string" || !/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z-]{12,17}$/.test(value.code)) invalidInput();
  const normalized = value.code.replaceAll("-", "").toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalized)) invalidInput();
  return { code: normalized };
}

export function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalidInput();
  return value;
}

function validatePathId(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalidInput();
  return value;
}

function projectProfile(value) {
  const fields = ["user_id", "nickname", "avatar_key"];
  if (value === null) return null;
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.user_id) ||
      typeof value.nickname !== "string" || [...value.nickname].length < 1 || [...value.nickname].length > 20 ||
      !AVATARS.has(value.avatar_key)) throw new Error("Connection response did not match its allowlist.");
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function projectPage(value, projectItem) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 || !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && CURSOR.test(value.next_cursor)))) {
    throw new Error("Connection list response did not match its allowlist.");
  }
  return { items: value.items.map(projectItem), next_cursor: value.next_cursor };
}

function projectConnection(value) {
  const fields = ["id", "status", "generation", "other_user"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) ||
      !CONNECTION_STATUSES.has(value.status) || !Number.isInteger(value.generation) || value.generation < 0) {
    throw new Error("Connection response did not match its allowlist.");
  }
  return { id: value.id, status: value.status, generation: value.generation, other_user: projectProfile(value.other_user) };
}

function projectInvite(value) {
  const fields = ["id", "created_at", "expires_at", "redeemed_at", "revoked_at"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) ||
      !validTimestamp(value.created_at) || !validTimestamp(value.expires_at) ||
      !validTimestampOrNull(value.redeemed_at) || !validTimestampOrNull(value.revoked_at)) {
    throw new Error("Invite response did not match its allowlist.");
  }
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function projectRequest(value) {
  const fields = ["id", "direction", "other_user", "status", "created_at", "expires_at"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) ||
      !["incoming", "outgoing"].includes(value.direction) || !REQUEST_STATUSES.has(value.status) ||
      !validTimestamp(value.created_at) || !validTimestamp(value.expires_at)) {
    throw new Error("Connection request response did not match its allowlist.");
  }
  return {
    id: value.id, direction: value.direction, other_user: projectProfile(value.other_user), status: value.status,
    created_at: value.created_at, expires_at: value.expires_at,
  };
}

function projectBlock(value) {
  const fields = ["id", "blocked_user", "created_at"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) || !validTimestamp(value.created_at)) {
    throw new Error("Block response did not match its allowlist.");
  }
  return { id: value.id, blocked_user: projectProfile(value.blocked_user), created_at: value.created_at };
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
  if (code === "PT403") return jsonResponse({ error: { code: databaseMessage === "signup_required" ? "REGISTRATION_REQUIRED" : "ACTION_FORBIDDEN", message: "요청을 수행할 수 없습니다.", request_id: requestId } }, 403, requestId);
  if (code === "PT404") return jsonResponse({ error: { code: "OBJECT_NOT_AVAILABLE", message: "요청한 항목을 찾을 수 없습니다.", request_id: requestId } }, 404, requestId);
  if (code === "PT409") return jsonResponse({ error: { code: databaseMessage === "idempotency_conflict" ? "IDEMPOTENCY_CONFLICT" : "STATE_CONFLICT", message: "관계 상태가 바뀌었습니다. 다시 확인해 주세요.", request_id: requestId } }, 409, requestId);
  if (code === "PT429") return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요.", request_id: requestId } }, 429, requestId);
  return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

function throwRpcError(error) {
  if (error) throw Object.assign(new Error("Connection request failed."), { databaseCode: error.code, databaseMessage: error.message });
}

async function listResponse(url, client, rpc, project) {
  const requestId = randomUUID();
  try {
    const input = validatePageQuery(url, { direction: rpc === "list_connection_requests" });
    const { data, error } = await client.rpc(rpc, input);
    throwRpcError(error);
    return jsonResponse(projectPage(data, project), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export function listConnectionsResponse(url, client) {
  return listResponse(url, client, "list_connections", projectConnection);
}

export function listConnectionInvitesResponse(url, client) {
  return listResponse(url, client, "list_connection_invites", projectInvite);
}

export function listConnectionRequestsResponse(url, client) {
  return listResponse(url, client, "list_connection_requests", projectRequest);
}

export function listBlocksResponse(url, client) {
  return listResponse(url, client, "list_blocks", projectBlock);
}

async function readMutation(request, expectedOrigin, secret) {
  const body = await validateMutationRequest(request, { expectedOrigin, secret });
  if (!exactObject(body, []) || Object.keys(body).length !== 0) invalidInput();
}

function resultId(value, expectedId = null) {
  if (!exactObject(value, ["id", "replayed"]) || Object.keys(value).length !== 2 || !UUID.test(value.id) ||
      (expectedId !== null && value.id !== expectedId) || typeof value.replayed !== "boolean") {
    throw new Error("Connection mutation result did not match its allowlist.");
  }
  return value;
}

async function callMutation(request, client, rpc, args, {
  expectedOrigin = process.env.APP_BASE_URL,
  secret = getCsrfSigningSecret(),
  status = 200,
  expectedId = null,
  input = "empty",
} = {}) {
  const requestId = randomUUID();
  try {
    let rpcArgs;
    if (input === "empty") {
      await readMutation(request, expectedOrigin, secret);
      rpcArgs = args;
    } else {
      const body = await validateMutationRequest(request, { expectedOrigin, secret });
      rpcArgs = args(body, request.headers);
    }
    const { data, error } = await client.rpc(rpc, rpcArgs);
    throwRpcError(error);
    return jsonResponse(resultId(data, expectedId), status, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export function createConnectionInviteResponse(request, client, options = {}) {
  const requestId = randomUUID();
  return (async () => {
    try {
      await readMutation(request, options.expectedOrigin ?? process.env.APP_BASE_URL, options.secret ?? getCsrfSigningSecret());
      const { data, error } = await client.rpc("create_connection_invite");
      throwRpcError(error);
      const fields = ["id", "link_path", "code", "expires_at"];
      if (!exactObject(data, fields) || Object.keys(data).length !== fields.length || !UUID.test(data.id) ||
          typeof data.link_path !== "string" || !/^\/connect#invite=[A-Za-z0-9_-]{32}$/.test(data.link_path) ||
          typeof data.code !== "string" || !/^[0-9A-HJKMNP-TV-Z]{12}$/.test(data.code) || !validTimestamp(data.expires_at)) {
        throw new Error("Invite result did not match its one-time allowlist.");
      }
      return jsonResponse(data, 201, requestId);
    } catch (error) { return errorResponse(error, requestId); }
  })();
}

export function previewConnectionInviteResponse(request, client, options = {}) {
  const requestId = randomUUID();
  return (async () => {
    try {
      const body = await validateMutationRequest(request, { expectedOrigin: options.expectedOrigin ?? process.env.APP_BASE_URL, secret: options.secret ?? getCsrfSigningSecret() });
      const p_secret = validateInviteSecret(body);
      const { data, error } = await client.rpc("preview_connection_invite", { p_secret });
      throwRpcError(error);
      if (!exactObject(data, ["inviter_nickname", "expires_at"]) || Object.keys(data).length !== 2 ||
          typeof data.inviter_nickname !== "string" || [...data.inviter_nickname].length < 1 || [...data.inviter_nickname].length > 20 ||
          !validTimestamp(data.expires_at)) throw new Error("Invite preview did not match its minimal allowlist.");
      return jsonResponse(data, 200, requestId);
    } catch (error) { return errorResponse(error, requestId); }
  })();
}

export function createConnectionRequestResponse(request, client, options = {}) {
  return callMutation(request, client, "create_connection_request", (body, headers) => ({
    p_request_key: validateIdempotencyKey(headers.get("idempotency-key")), p_secret: validateInviteSecret(body),
  }), { ...options, status: 201, input: "custom" });
}

export function acceptConnectionRequestResponse(requestId, request, client, options = {}) {
  return callMutation(request, client, "accept_connection_request", { p_request_id: validatePathId(requestId) }, { ...options, expectedId: validatePathId(requestId) });
}

export function rejectConnectionRequestResponse(requestId, request, client, options = {}) {
  return callMutation(request, client, "reject_connection_request", { p_request_id: validatePathId(requestId) }, { ...options, expectedId: validatePathId(requestId) });
}

export function cancelConnectionRequestResponse(requestId, request, client, options = {}) {
  return callMutation(request, client, "cancel_connection_request", { p_request_id: validatePathId(requestId) }, { ...options, expectedId: validatePathId(requestId) });
}

export function disconnectResponse(connectionId, request, client, options = {}) {
  return callMutation(request, client, "disconnect", { p_connection_id: validatePathId(connectionId) }, { ...options, expectedId: validatePathId(connectionId) });
}

export function revokeConnectionInviteResponse(inviteId, request, client, options = {}) {
  return callMutation(request, client, "revoke_connection_invite", { p_invite_id: validatePathId(inviteId) }, { ...options, expectedId: validatePathId(inviteId) });
}

export function createBlockResponse(request, client, options = {}) {
  return callMutation(request, client, "create_block", (body) => {
    if (!exactObject(body, ["user_id"]) || Object.keys(body).length !== 1 || !UUID.test(body.user_id)) invalidInput();
    return { p_user_id: body.user_id };
  }, { ...options, input: "custom" });
}

export function revokeBlockResponse(blockId, request, client, options = {}) {
  return callMutation(request, client, "revoke_block", { p_block_id: validatePathId(blockId) }, { ...options, expectedId: validatePathId(blockId) });
}
