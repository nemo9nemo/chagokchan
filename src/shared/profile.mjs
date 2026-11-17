import policy from "../../policies/app-policy.json" with { type: "json" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const avatarKeys = Object.freeze([...policy.profile.avatar_keys]);
export const defaultNickname = policy.profile.default_nickname;

export function normalizeNickname(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").replace(/^ +| +$/g, "");
  const length = [...normalized].length;
  if (length < policy.limits.nickname_codepoints_min || length > policy.limits.nickname_codepoints_max ||
      /\p{Cc}/u.test(normalized) || !/\S/u.test(normalized) || /[\uD800-\uDFFF]/u.test(normalized)) return null;
  return normalized;
}

// A display aid from an already-authorized ID, never an authentication or lookup key.
export function profileDisplayCode(userId) {
  return typeof userId === "string" && UUID.test(userId) ? userId.replaceAll("-", "").slice(-12).toUpperCase() : null;
}

export function formatDisplayCode(value) {
  return typeof value === "string" && /^[0-9A-F]{12}$/.test(value) ? value.match(/.{4}/g).join("-") : null;
}
