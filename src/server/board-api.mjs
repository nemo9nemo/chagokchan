import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { projectBunch } from "./goal-api.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOAL_STATES = new Set(["active", "completed", "archived"]);

function exactObject(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key));
}

function invalidInput() {
  throw new ApiRequestError(400, "INVALID_INPUT", "입력 형식이 올바르지 않습니다.");
}

function isTextOrNull(value, maxLength) {
  return value === null || (typeof value === "string" && [...value].length <= maxLength);
}

function projectMinimalUser(value) {
  const fields = ["user_id", "nickname", "avatar_key"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.user_id) ||
      !isTextOrNull(value.nickname, 80) || !isTextOrNull(value.avatar_key, 40)) {
    throw new Error("Board response did not match its allowlist.");
  }
  return { user_id: value.user_id, nickname: value.nickname, avatar_key: value.avatar_key };
}

export function projectBoardView(value) {
  const ownerFields = ["viewer_role", "id", "goal_id", "kind", "revision", "next_target_count", "shared_title", "shared_description", "current_bunch"];
  if (value?.viewer_role === "owner") {
    if (!exactObject(value, ownerFields) || Object.keys(value).length !== ownerFields.length ||
        !UUID.test(value.id) || !UUID.test(value.goal_id) || !["personal", "shared"].includes(value.kind) ||
        !Number.isInteger(value.revision) || value.revision < 1 || !Number.isInteger(value.next_target_count) ||
        value.next_target_count < 1 || value.next_target_count > 100 || !isTextOrNull(value.shared_title, 80) ||
        !isTextOrNull(value.shared_description, 1000) ||
        (value.kind === "personal" && (value.shared_title !== null || value.shared_description !== null)) ||
        (value.kind === "shared" && (typeof value.shared_title !== "string" || value.shared_title.length < 1))) {
      throw new Error("Board response did not match its owner allowlist.");
    }
    return { ...value, current_bunch: projectBunch(value.current_bunch) };
  }

  const contributorFields = ["viewer_role", "id", "kind", "shared_title", "shared_description", "owner", "goal_state", "current_bunch", "can_praise"];
  if (value?.viewer_role === "contributor") {
    if (!exactObject(value, contributorFields) || Object.keys(value).length !== contributorFields.length ||
        !UUID.test(value.id) || value.kind !== "shared" || typeof value.shared_title !== "string" ||
        [...value.shared_title].length < 1 || [...value.shared_title].length > 80 ||
        !isTextOrNull(value.shared_description, 1000) || !GOAL_STATES.has(value.goal_state) ||
        typeof value.can_praise !== "boolean" || value.can_praise !== (value.goal_state === "active")) {
      throw new Error("Board response did not match its contributor allowlist.");
    }
    return {
      viewer_role: "contributor", id: value.id, kind: "shared", shared_title: value.shared_title,
      shared_description: value.shared_description, owner: projectMinimalUser(value.owner),
      goal_state: value.goal_state, current_bunch: projectBunch(value.current_bunch), can_praise: value.can_praise,
    };
  }
  throw new Error("Board response did not match its role allowlist.");
}

export function validateBoardMembersQuery(url) {
  const params = url.searchParams;
  if ([...params.keys()].some((key) => !["cursor", "limit"].includes(key)) ||
      ["cursor", "limit"].some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) invalidInput();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  return { p_cursor: cursor, p_limit: limit };
}

function projectMember(value) {
  const fields = ["user", "role", "status", "connection_generation"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length ||
      !["active", "revoked"].includes(value.status) || value.role !== "contributor" ||
      !Number.isInteger(value.connection_generation) || value.connection_generation < 1) {
    throw new Error("Member response did not match its allowlist.");
  }
  return { user: projectMinimalUser(value.user), role: value.role, status: value.status, connection_generation: value.connection_generation };
}

function projectMembersPage(value) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 ||
      !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.next_cursor)))) {
    throw new Error("Member list response did not match its allowlist.");
  }
  return { items: value.items.map(projectMember), next_cursor: value.next_cursor };
}

function jsonResponse(body, status, requestId) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId } });
}

function errorResponse(error, requestId) {
  if (error instanceof ApiRequestError) return jsonResponse({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status, requestId);
  const code = error && typeof error === "object" && "databaseCode" in error ? error.databaseCode : undefined;
  const message = error && typeof error === "object" && "databaseMessage" in error ? error.databaseMessage : undefined;
  if (code === "PT400") return jsonResponse({ error: { code: "INVALID_INPUT", message: "입력 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  if (code === "PT401" || code === "PGRST301") return jsonResponse({ error: { code: "AUTH_REQUIRED", message: "현재 세션이 필요합니다.", request_id: requestId } }, 401, requestId);
  if (code === "PT403") return jsonResponse({ error: { code: "ACTION_FORBIDDEN", message: "요청을 수행할 수 없습니다.", request_id: requestId } }, 403, requestId);
  if (code === "PT404") return jsonResponse({ error: { code: "OBJECT_NOT_AVAILABLE", message: "요청한 항목을 찾을 수 없습니다.", request_id: requestId } }, 404, requestId);
  if (code === "PT409") return jsonResponse({ error: { code: message === "revision_conflict" ? "REVISION_CONFLICT" : "STATE_CONFLICT", message: "판 상태가 바뀌었습니다. 다시 확인해 주세요.", request_id: requestId } }, 409, requestId);
  if (code === "PT429") return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요.", request_id: requestId } }, 429, requestId);
  return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

function rpcError(error) {
  if (error) throw Object.assign(new Error("Board request failed."), { databaseCode: error.code, databaseMessage: error.message });
}

export async function getBoardResponse(boardId, client) {
  const requestId = randomUUID();
  if (typeof boardId !== "string" || !UUID.test(boardId)) return jsonResponse({ error: { code: "INVALID_INPUT", message: "판 ID 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  try {
    const { data, error } = await client.rpc("get_board", { p_board_id: boardId });
    rpcError(error);
    return jsonResponse(projectBoardView(data), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export async function listBoardMembersResponse(boardId, url, client) {
  const requestId = randomUUID();
  if (typeof boardId !== "string" || !UUID.test(boardId)) return jsonResponse({ error: { code: "INVALID_INPUT", message: "판 ID 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  try {
    const input = validateBoardMembersQuery(url);
    const { data, error } = await client.rpc("list_board_members", { p_board_id: boardId, ...input });
    rpcError(error);
    return jsonResponse(projectMembersPage(data), 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export async function listMySharedBoardsResponse(url, client) {
  const requestId = randomUUID();
  try {
    const input = validateBoardMembersQuery(url);
    const { data, error } = await client.rpc("list_my_shared_boards", input);
    rpcError(error);
    if (!exactObject(data, ["items", "next_cursor"]) || Object.keys(data).length !== 2 || !Array.isArray(data.items) || data.items.length > 50 ||
        !(data.next_cursor === null || (typeof data.next_cursor === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(data.next_cursor)))) {
      throw new Error("Shared board list response did not match its allowlist.");
    }
    return jsonResponse({ items: data.items.map(projectBoardView), next_cursor: data.next_cursor }, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

function validateGrantInput(value, boardId, userId) {
  if (typeof boardId !== "string" || !UUID.test(boardId) || typeof userId !== "string" || !UUID.test(userId) ||
      !exactObject(value, ["role"]) || (Object.hasOwn(value, "role") && value.role !== "contributor")) invalidInput();
  return { p_board_id: boardId, p_user_id: userId };
}

function validateRevokeInput(value, boardId, userId) {
  if (typeof boardId !== "string" || !UUID.test(boardId) || typeof userId !== "string" || !UUID.test(userId) ||
      !exactObject(value, []) || Object.keys(value).length !== 0) invalidInput();
  return { p_board_id: boardId, p_user_id: userId };
}

async function memberMutationResponse(rpc, boardId, userId, request, client, validate, { expectedOrigin, secret }) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    const input = validate(body, boardId, userId);
    const { data, error } = await client.rpc(rpc, input);
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== boardId || typeof data.replayed !== "boolean") {
      throw new Error("Board mutation result did not match its allowlist.");
    }
    return jsonResponse({ id: data.id, replayed: data.replayed }, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}

export function grantBoardMemberResponse(boardId, userId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  return memberMutationResponse("grant_board_member", boardId, userId, request, client, validateGrantInput, { expectedOrigin, secret });
}

export function revokeBoardMemberResponse(boardId, userId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  return memberMutationResponse("revoke_board_member", boardId, userId, request, client, validateRevokeInput, { expectedOrigin, secret });
}
