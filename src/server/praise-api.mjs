import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function exactObject(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key));
}

function invalidInput() {
  throw new ApiRequestError(400, "INVALID_INPUT", "입력 형식이 올바르지 않습니다.");
}

function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validOptionalPraiseFields(value) {
  return (!Object.hasOwn(value, "message") || value.message === null ||
      (typeof value.message === "string" && [...value.message].length <= 1000)) &&
    (!Object.hasOwn(value, "occurred_on") || value.occurred_on === null || validDate(value.occurred_on));
}

export function validateCreatePraiseInput(value, idempotencyKey, boardId) {
  if (typeof boardId !== "string" || !UUID.test(boardId) ||
      !exactObject(value, ["message", "occurred_on"]) || !validOptionalPraiseFields(value) ||
      typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) invalidInput();
  return {
    p_request_key: idempotencyKey,
    p_board_id: boardId,
    p_message: value.message ?? null,
    p_occurred_on: value.occurred_on ?? null,
  };
}

export function validateEditSelfPraiseInput(value, praiseId) {
  if (typeof praiseId !== "string" || !UUID.test(praiseId) ||
      !exactObject(value, ["message", "occurred_on"]) || Object.keys(value).length < 1 ||
      !validOptionalPraiseFields(value)) invalidInput();
  return { p_praise_id: praiseId, p_patch: value };
}

export function validateCancelPraiseInput(value, praiseId) {
  if (typeof praiseId !== "string" || !UUID.test(praiseId) || !exactObject(value, []) || Object.keys(value).length !== 0) invalidInput();
  return { p_praise_id: praiseId };
}

export function validateBoardPraisesQuery(url) {
  const params = url.searchParams;
  const allowed = ["cursor", "limit", "bunch_id", "include_hidden"];
  if ([...params.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) invalidInput();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  const bunchId = params.get("bunch_id");
  if (bunchId !== null && !UUID.test(bunchId)) invalidInput();
  const rawIncludeHidden = params.get("include_hidden");
  if (rawIncludeHidden !== null && rawIncludeHidden !== "true" && rawIncludeHidden !== "false") invalidInput();
  return {
    p_bunch_id: bunchId,
    p_cursor: cursor,
    p_limit: limit,
    p_include_hidden: rawIncludeHidden === "true",
  };
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isTimestampOrNull(value) {
  return value === null || isTimestamp(value);
}

function projectOwnerPraise(value) {
  const fields = ["viewer_role", "id", "bunch_id", "source", "actor", "actor_label", "message", "occurred_on", "recorded_at", "cancelled_at", "hidden_at", "excluded_at", "author_erased_at"];
  const actorFields = ["user_id", "nickname", "avatar_key"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || value.viewer_role !== "owner" ||
      !UUID.test(value.id) || !UUID.test(value.bunch_id) || !["self", "peer"].includes(value.source) ||
      !(value.actor === null || (exactObject(value.actor, actorFields) && Object.keys(value.actor).length === 3 &&
        UUID.test(value.actor.user_id) && (value.actor.nickname === null || (typeof value.actor.nickname === "string" && [...value.actor.nickname].length <= 80)) &&
        (value.actor.avatar_key === null || (typeof value.actor.avatar_key === "string" && value.actor.avatar_key.length <= 40)))) ||
      typeof value.actor_label !== "string" || [...value.actor_label].length > 80 ||
      !(value.message === null || (typeof value.message === "string" && [...value.message].length <= 1000)) ||
      !(value.occurred_on === null || validDate(value.occurred_on)) || !isTimestamp(value.recorded_at) ||
      !isTimestampOrNull(value.cancelled_at) || !isTimestampOrNull(value.hidden_at) ||
      !isTimestampOrNull(value.excluded_at) || !isTimestampOrNull(value.author_erased_at) ||
      (value.cancelled_at !== null && (value.message !== null || value.occurred_on !== null)) ||
      (value.author_erased_at !== null && (value.actor !== null || value.message !== null || value.occurred_on !== null))) {
    throw new Error("Praise response did not match its owner allowlist.");
  }
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function projectContributorPraise(value) {
  const fields = ["viewer_role", "id", "bunch_id", "source", "message", "recorded_at", "cancelled_at"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || value.viewer_role !== "contributor" ||
      !UUID.test(value.id) || !UUID.test(value.bunch_id) || value.source !== "peer" ||
      !(value.message === null || (typeof value.message === "string" && [...value.message].length <= 1000)) ||
      !isTimestamp(value.recorded_at) || !isTimestampOrNull(value.cancelled_at) ||
      (value.cancelled_at !== null && value.message !== null)) {
    throw new Error("Praise response did not match its contributor allowlist.");
  }
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function projectPraise(value) {
  if (value?.viewer_role === "owner") return projectOwnerPraise(value);
  if (value?.viewer_role === "contributor") return projectContributorPraise(value);
  throw new Error("Praise response did not match its allowlist.");
}

function projectPraisePage(value) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 ||
      !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.next_cursor)))) {
    throw new Error("Praise list response did not match its allowlist.");
  }
  return { items: value.items.map(projectPraise), next_cursor: value.next_cursor };
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
  if (code === "PT403") {
    const registration = databaseMessage === "signup_required";
    return jsonResponse({ error: { code: registration ? "REGISTRATION_REQUIRED" : "ACTION_FORBIDDEN", message: registration ? "계정 등록을 완료해야 합니다." : "요청을 수행할 수 없습니다.", request_id: requestId } }, 403, requestId);
  }
  if (code === "PT404") return jsonResponse({ error: { code: "OBJECT_NOT_AVAILABLE", message: "요청한 항목을 찾을 수 없습니다.", request_id: requestId } }, 404, requestId);
  if (code === "PT409") {
    const mapped = databaseMessage === "idempotency_conflict" ? "IDEMPOTENCY_CONFLICT" : "STATE_CONFLICT";
    return jsonResponse({ error: { code: mapped, message: "기록 상태가 바뀌었습니다. 다시 확인해 주세요.", request_id: requestId } }, 409, requestId);
  }
  if (code === "PT429") return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요.", request_id: requestId } }, 429, requestId);
  return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

function rpcError(error) {
  if (error) throw Object.assign(new Error("Praise request failed."), { databaseCode: error.code, databaseMessage: error.message });
}

export async function createPraiseResponse(boardId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    const input = validateCreatePraiseInput(body, request.headers.get("idempotency-key"), boardId);
    const { data, error } = await client.rpc("create_personal_praise", input);
    rpcError(error);
    if (!exactObject(data, ["id", "bunch_id", "replayed"]) || Object.keys(data).length !== 3 ||
        !UUID.test(data.id) || !UUID.test(data.bunch_id) || typeof data.replayed !== "boolean") throw new Error("Praise result did not match its allowlist.");
    return jsonResponse(data, 201, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export async function editSelfPraiseResponse(praiseId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    const input = validateEditSelfPraiseInput(body, praiseId);
    const { data, error } = await client.rpc("edit_self_praise", input);
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== praiseId || typeof data.replayed !== "boolean") throw new Error("Praise result did not match its allowlist.");
    return jsonResponse(data, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export async function cancelPraiseResponse(praiseId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    const input = validateCancelPraiseInput(body, praiseId);
    const { data, error } = await client.rpc("cancel_praise", input);
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== praiseId || typeof data.replayed !== "boolean") throw new Error("Praise result did not match its allowlist.");
    return jsonResponse(data, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export async function listBoardPraisesResponse(boardId, url, client) {
  const requestId = randomUUID();
  if (typeof boardId !== "string" || !UUID.test(boardId)) return jsonResponse({ error: { code: "INVALID_INPUT", message: "판 ID 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  try {
    const input = validateBoardPraisesQuery(url);
    const { data, error } = await client.rpc("list_board_praises", { p_board_id: boardId, ...input });
    rpcError(error);
    return jsonResponse(projectPraisePage(data), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}
