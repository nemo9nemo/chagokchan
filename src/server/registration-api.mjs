import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { validateMeProjection } from "./local-user-session.mjs";

function response(body, status, requestId) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId } });
}

function rpcFailure(error) {
  if (!error) return;
  if (["PT401", "PGRST301", "PGRST303"].includes(error.code)) throw new ApiRequestError(401, "AUTH_REQUIRED", "현재 세션이 필요합니다.");
  if (error.code === "PT400") throw new ApiRequestError(400, "INVALID_INPUT", "가입 확인을 다시 확인해 주세요.");
  if (error.code === "PT409" && error.message === "policy_version_changed") throw new ApiRequestError(409, "POLICY_VERSION_CHANGED", "최신 가입 안내를 다시 확인해 주세요.");
  if (error.code === "PT403") throw new ApiRequestError(403, "ACTION_FORBIDDEN", "이 계정으로 가입을 진행할 수 없습니다.");
  throw new Error("Registration lookup is unavailable.");
}

function failure(error, requestId) {
  if (error instanceof ApiRequestError) return response({ error: { code: error.code, message: error.message, request_id: requestId } }, error.status, requestId);
  return response({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, 503, requestId);
}

export function validateBootstrapInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== "adult_confirmed|registration_policy_version" ||
      value.adult_confirmed !== true || typeof value.registration_policy_version !== "string" ||
      value.registration_policy_version.length > 40 || !/^\d+\.\d+\.\d+$/.test(value.registration_policy_version)) {
    throw new ApiRequestError(400, "INVALID_INPUT", "가입 확인을 다시 확인해 주세요.");
  }
  return { p_adult_confirmed: true, p_registration_policy_version: value.registration_policy_version };
}

export async function bootstrapAccountResponse(request, client, userId, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret(), env = process.env } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret, env });
    const input = validateBootstrapInput(body);
    const { data, error } = await client.rpc("bootstrap_account", input);
    rpcFailure(error);
    return response(validateMeProjection(data, userId), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function authContextResponse(client, userId) {
  const requestId = randomUUID();
  try {
    const { data, error } = await client.rpc("get_auth_context");
    rpcFailure(error);
    const next = { active: "/", signup_required: "/signup", deleting: "/account/deletion" };
    if (!data || Object.keys(data).sort().join("|") !== "account_state|next|user_id" || data.user_id !== userId ||
        !Object.hasOwn(next, data.account_state) || data.next !== next[data.account_state]) throw new Error("Auth context does not match its contract.");
    return response({ user_id: userId, account_state: data.account_state, next: data.next }, 200, requestId);
  } catch (error) { return failure(error, requestId); }
}
