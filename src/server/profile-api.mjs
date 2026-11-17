import { randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { validateMeProjection } from "./local-user-session.mjs";
import { avatarKeys, normalizeNickname } from "../shared/profile.mjs";

const invalid = () => { throw new ApiRequestError(400, "INVALID_INPUT", "이름은 공백만 사용하지 않고 1~20자로, 아바타는 목록에서 선택해 주세요."); };
export function validateUpdateMeInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length < 1 ||
      Object.keys(body).some(key => !["nickname", "avatar_key"].includes(key))) invalid();
  const nickname = Object.hasOwn(body, "nickname") ? normalizeNickname(body.nickname) : null;
  if ((Object.hasOwn(body, "nickname") && nickname === null) ||
      (Object.hasOwn(body, "avatar_key") && !avatarKeys.includes(body.avatar_key))) invalid();
  return { p_nickname: nickname, p_avatar_key: Object.hasOwn(body, "avatar_key") ? body.avatar_key : null };
}

function json(body, status, requestId) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
function rpcFailure(error) {
  if (!error) return;
  if (["PT401", "PGRST301", "PGRST303"].includes(error.code)) throw new ApiRequestError(401, "AUTH_REQUIRED", "현재 세션이 필요합니다.");
  if (error.code === "PT403") throw new ApiRequestError(403, error.message === "signup_required" ? "REGISTRATION_REQUIRED" : "ACTION_FORBIDDEN", "현재 계정으로 수정할 수 없습니다.");
  if (error.code === "PT400") invalid();
  if (error.code === "PT429") throw new ApiRequestError(429, "RATE_LIMITED", "변경 요청이 많아요. 잠시 후 다시 시도해 주세요.");
  throw new Error("Profile update unavailable.");
}

export async function updateMeResponse(request, client, userId, { expectedOrigin = process.env.APP_BASE_URL, secret = getCsrfSigningSecret(), env = process.env } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin, secret, env });
    const input = validateUpdateMeInput(body);
    const { data, error } = await client.rpc("update_my_profile", input);
    rpcFailure(error);
    const me = validateMeProjection(data, userId);
    if (normalizeNickname(me.profile.nickname) !== me.profile.nickname || !avatarKeys.includes(me.profile.avatar_key) ||
        (input.p_nickname !== null && me.profile.nickname !== input.p_nickname) ||
        (input.p_avatar_key !== null && me.profile.avatar_key !== input.p_avatar_key)) throw new Error("Profile result mismatch.");
    return json(me, 200, requestId);
  } catch (error) {
    const safe = error instanceof ApiRequestError ? error : new ApiRequestError(503, "DEPENDENCY_UNAVAILABLE", "저장 결과를 확인하지 못했어요. 현재 이름을 확인한 뒤 다시 시도해 주세요.");
    return json({ error: { code: safe.code, message: safe.message, request_id: requestId } }, safe.status, requestId);
  }
}
