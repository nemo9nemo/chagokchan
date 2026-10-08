import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOAL_STATUSES = new Set(["active", "completed", "archived"]);
const GOAL_TRANSITION_RPCS = new Map([["complete", "complete_goal"], ["archive", "archive_goal"], ["resume", "resume_goal"]]);

function exactObject(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key));
}

function validOptionalText(value, maxLength) {
  return value === undefined || value === null || (typeof value === "string" && [...value].length <= maxLength);
}

function validTextOrNull(value, maxLength) {
  return value === null || (typeof value === "string" && [...value].length <= maxLength);
}

function invalidInput() {
  throw new ApiRequestError(400, "INVALID_INPUT", "입력 형식이 올바르지 않습니다.");
}

export function validateCreateGoalInput(value, idempotencyKey) {
  if (!exactObject(value, ["title", "private_description", "personal_target_count", "shared_board"]) ||
      typeof value.title !== "string" || [...value.title].length > 80 ||
      !validOptionalText(value.private_description, 1000) ||
      (value.personal_target_count !== undefined && (!Number.isInteger(value.personal_target_count) || value.personal_target_count < 1 || value.personal_target_count > 100)) ||
      (value.shared_board !== undefined && value.shared_board !== null &&
        (!exactObject(value.shared_board, ["title", "description", "target_count"]) ||
          typeof value.shared_board.title !== "string" || [...value.shared_board.title].length > 80 ||
          !validOptionalText(value.shared_board.description, 1000) ||
          !Number.isInteger(value.shared_board.target_count) || value.shared_board.target_count < 1 || value.shared_board.target_count > 100)) ||
      typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) invalidInput();
  return {
    p_request_key: idempotencyKey,
    p_title: value.title,
    p_private_description: value.private_description ?? null,
    p_personal_target_count: value.personal_target_count ?? 20,
    p_shared_board: value.shared_board ?? null,
  };
}

export function validateUpdateGoalInput(value) {
  if (!exactObject(value, ["expected_revision", "title", "private_description"]) ||
      !Number.isInteger(value.expected_revision) || value.expected_revision < 1 ||
      (!Object.hasOwn(value, "title") && !Object.hasOwn(value, "private_description")) ||
      (Object.hasOwn(value, "title") && (typeof value.title !== "string" || [...value.title].length > 80)) ||
      (Object.hasOwn(value, "private_description") && !validOptionalText(value.private_description, 1000))) invalidInput();
  return {
    p_expected_revision: value.expected_revision,
    p_title: value.title ?? null,
    p_private_description: value.private_description ?? null,
    p_update_title: Object.hasOwn(value, "title"),
    p_update_private_description: Object.hasOwn(value, "private_description"),
  };
}

export function validateGoalActionInput(value) {
  if (!exactObject(value, ["expected_revision"]) || Object.keys(value).length !== 1 ||
      !Number.isInteger(value.expected_revision) || value.expected_revision < 1) invalidInput();
  return { p_expected_revision: value.expected_revision };
}

export function validateUpdateBoardInput(value) {
  const fields = ["expected_revision", "next_target_count", "shared_title", "shared_description"];
  if (!exactObject(value, fields) || !Number.isInteger(value.expected_revision) || value.expected_revision < 1 ||
      Object.keys(value).length < 2 ||
      (Object.hasOwn(value, "next_target_count") && (!Number.isInteger(value.next_target_count) || value.next_target_count < 1 || value.next_target_count > 100)) ||
      (Object.hasOwn(value, "shared_title") && (typeof value.shared_title !== "string" || [...value.shared_title].length < 1 || [...value.shared_title].length > 80)) ||
      (Object.hasOwn(value, "shared_description") && !validOptionalText(value.shared_description, 1000))) invalidInput();
  const { expected_revision, ...patch } = value;
  return { expected_revision, ...patch };
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isTimestampOrNull(value) {
  return value === null || isTimestamp(value);
}

export function projectBunch(value) {
  if (value === null) return null;
  if (!exactObject(value, ["id", "cycle_no", "target_count", "valid_count", "progress_state", "completed_at"]) ||
      Object.keys(value).length !== 6 || !UUID.test(value.id) || !Number.isInteger(value.cycle_no) || value.cycle_no < 1 ||
      !Number.isInteger(value.target_count) || value.target_count < 1 || value.target_count > 100 ||
      !Number.isInteger(value.valid_count) || value.valid_count < 0 || value.valid_count > value.target_count ||
      !["incomplete", "complete"].includes(value.progress_state) || !isTimestampOrNull(value.completed_at)) {
    throw new Error("Goal response did not match its allowlist.");
  }
  return {
    id: value.id,
    cycle_no: value.cycle_no,
    target_count: value.target_count,
    valid_count: value.valid_count,
    progress_state: value.progress_state,
    completed_at: value.completed_at,
  };
}

export function projectGoalDetail(value) {
  const goalFields = ["id", "title", "private_description", "status", "revision", "created_at", "completed_at", "archived_at"];
  const boardFields = ["viewer_role", "id", "goal_id", "kind", "revision", "next_target_count", "shared_title", "shared_description", "current_bunch"];
  if (!exactObject(value, ["goal", "boards"]) || Object.keys(value).length !== 2 ||
      !exactObject(value.goal, goalFields) || Object.keys(value.goal).length !== goalFields.length ||
      !UUID.test(value.goal.id) || typeof value.goal.title !== "string" || [...value.goal.title].length > 80 ||
      !validTextOrNull(value.goal.private_description, 1000) || !GOAL_STATUSES.has(value.goal.status) ||
      !Number.isInteger(value.goal.revision) || value.goal.revision < 1 || !isTimestamp(value.goal.created_at) ||
      !isTimestampOrNull(value.goal.completed_at) || !isTimestampOrNull(value.goal.archived_at) ||
      !Array.isArray(value.boards) || value.boards.length < 1 || value.boards.length > 2) {
    throw new Error("Goal response did not match its allowlist.");
  }
  const boards = value.boards.map((board) => {
    if (!exactObject(board, boardFields) || Object.keys(board).length !== boardFields.length || board.viewer_role !== "owner" ||
        !UUID.test(board.id) || board.goal_id !== value.goal.id || !["personal", "shared"].includes(board.kind) ||
        !Number.isInteger(board.revision) || board.revision < 1 || !Number.isInteger(board.next_target_count) ||
        board.next_target_count < 1 || board.next_target_count > 100 || !validTextOrNull(board.shared_title, 80) ||
        !validTextOrNull(board.shared_description, 1000) ||
        (board.kind === "personal" && (board.shared_title !== null || board.shared_description !== null)) ||
        (board.kind === "shared" && (typeof board.shared_title !== "string" || board.shared_title.length === 0))) {
      throw new Error("Goal response did not match its allowlist.");
    }
    return {
      viewer_role: "owner",
      id: board.id,
      goal_id: board.goal_id,
      kind: board.kind,
      revision: board.revision,
      next_target_count: board.next_target_count,
      shared_title: board.shared_title,
      shared_description: board.shared_description,
      current_bunch: projectBunch(board.current_bunch),
    };
  });
  if (boards.filter((board) => board.kind === "personal").length !== 1 ||
      boards.filter((board) => board.kind === "shared").length > 1) throw new Error("Goal response did not match its allowlist.");
  return {
    goal: {
      id: value.goal.id,
      title: value.goal.title,
      private_description: value.goal.private_description,
      status: value.goal.status,
      revision: value.goal.revision,
      created_at: value.goal.created_at,
      completed_at: value.goal.completed_at,
      archived_at: value.goal.archived_at,
    },
    boards,
  };
}

export function validateGoalsQuery(url) {
  const params = url.searchParams;
  if (["cursor", "limit", "status"].some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512)) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) invalidInput();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  const status = params.get("status");
  if (status !== null && !GOAL_STATUSES.has(status)) invalidInput();
  return { p_cursor: cursor, p_limit: limit, p_status: status };
}

export function validateBunchesQuery(url) {
  const params = url.searchParams;
  if (["cursor", "limit"].some((key) => params.getAll(key).length > 1)) invalidInput();
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512)) invalidInput();
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) invalidInput();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidInput();
  return { p_cursor: cursor, p_limit: limit };
}

function projectGoalSummary(value) {
  const fields = ["id", "title", "private_description", "status", "revision", "created_at", "completed_at", "archived_at"];
  if (!exactObject(value, fields) || Object.keys(value).length !== fields.length || !UUID.test(value.id) ||
      typeof value.title !== "string" || [...value.title].length < 1 || [...value.title].length > 80 ||
      !validTextOrNull(value.private_description, 1000) || !GOAL_STATUSES.has(value.status) ||
      !Number.isInteger(value.revision) || value.revision < 1 || !isTimestamp(value.created_at) ||
      !isTimestampOrNull(value.completed_at) || !isTimestampOrNull(value.archived_at)) {
    throw new Error("Goal list response did not match its allowlist.");
  }
  return {
    id: value.id,
    title: value.title,
    private_description: value.private_description,
    status: value.status,
    revision: value.revision,
    created_at: value.created_at,
    completed_at: value.completed_at,
    archived_at: value.archived_at,
  };
}

function projectGoalsPage(value) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 ||
      !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.next_cursor)))) {
    throw new Error("Goal list response did not match its allowlist.");
  }
  return { items: value.items.map(projectGoalSummary), next_cursor: value.next_cursor };
}

function projectBunchesPage(value) {
  if (!exactObject(value, ["items", "next_cursor"]) || Object.keys(value).length !== 2 ||
      !Array.isArray(value.items) || value.items.length > 50 ||
      !(value.next_cursor === null || (typeof value.next_cursor === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.next_cursor)))) {
    throw new Error("Bunch list response did not match its allowlist.");
  }
  return { items: value.items.map(projectBunch), next_cursor: value.next_cursor };
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
    const mapped = databaseMessage === "idempotency_conflict" ? "IDEMPOTENCY_CONFLICT" :
      databaseMessage === "revision_conflict" ? "REVISION_CONFLICT" :
        ["active_goal_limit", "retained_goal_limit"].includes(databaseMessage) ? "RESOURCE_LIMIT_REACHED" : "STATE_CONFLICT";
    return jsonResponse({ error: { code: mapped, message: "목표 상태가 바뀌었습니다. 다시 확인해 주세요.", request_id: requestId } }, 409, requestId);
  }
  if (code === "PT429") return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요.", request_id: requestId } }, 429, requestId);
  return jsonResponse({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

function rpcError(error) {
  if (error) throw Object.assign(new Error("Goal request failed."), { databaseCode: error.code, databaseMessage: error.message });
}

export async function createGoalResponse(request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    const input = validateCreateGoalInput(body, request.headers.get("idempotency-key"));
    const { data, error } = await client.rpc("create_goal", input);
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || !UUID.test(data.id) || typeof data.replayed !== "boolean") {
      throw new Error("Goal mutation result did not match its allowlist.");
    }
    return jsonResponse({ id: data.id, replayed: data.replayed }, 201, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function getGoalResponse(goalId, client) {
  const requestId = randomUUID();
  if (typeof goalId !== "string" || !UUID.test(goalId)) {
    return jsonResponse({ error: { code: "INVALID_INPUT", message: "목표 ID 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  }
  try {
    const { data, error } = await client.rpc("get_goal", { p_goal_id: goalId });
    rpcError(error);
    return jsonResponse(projectGoalDetail(data), 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function listGoalsResponse(url, client) {
  const requestId = randomUUID();
  try {
    const input = validateGoalsQuery(url);
    const { data, error } = await client.rpc("list_goals", input);
    rpcError(error);
    return jsonResponse(projectGoalsPage(data), 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function transitionGoalResponse(goalId, action, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    if (typeof goalId !== "string" || !UUID.test(goalId) || !GOAL_TRANSITION_RPCS.has(action)) invalidInput();
    const input = validateGoalActionInput(body);
    const { data, error } = await client.rpc(GOAL_TRANSITION_RPCS.get(action), { p_goal_id: goalId, ...input });
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== goalId || typeof data.replayed !== "boolean") {
      throw new Error("Goal transition result did not match its allowlist.");
    }
    return jsonResponse({ id: data.id, replayed: data.replayed }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function updateBoardResponse(boardId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    if (typeof boardId !== "string" || !UUID.test(boardId)) invalidInput();
    const p_patch = validateUpdateBoardInput(body);
    const { data, error } = await client.rpc("update_board", { p_board_id: boardId, p_patch });
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== boardId || typeof data.replayed !== "boolean") {
      throw new Error("Board mutation result did not match its allowlist.");
    }
    return jsonResponse({ id: data.id, replayed: data.replayed }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function listBunchesResponse(boardId, url, client) {
  const requestId = randomUUID();
  if (typeof boardId !== "string" || !UUID.test(boardId)) {
    return jsonResponse({ error: { code: "INVALID_INPUT", message: "판 ID 형식이 올바르지 않습니다.", request_id: requestId } }, 400, requestId);
  }
  try {
    const input = validateBunchesQuery(url);
    const { data, error } = await client.rpc("list_bunches", { p_board_id: boardId, ...input });
    rpcError(error);
    return jsonResponse(projectBunchesPage(data), 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function updateGoalResponse(goalId, request, client, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret });
    if (typeof goalId !== "string" || !UUID.test(goalId)) invalidInput();
    const input = validateUpdateGoalInput(body);
    const { data, error } = await client.rpc("update_goal", { p_goal_id: goalId, ...input });
    rpcError(error);
    if (!exactObject(data, ["id", "replayed"]) || Object.keys(data).length !== 2 || data.id !== goalId || typeof data.replayed !== "boolean") {
      throw new Error("Goal mutation result did not match its allowlist.");
    }
    return jsonResponse({ id: data.id, replayed: data.replayed }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
