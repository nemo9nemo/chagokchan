import policy from "../../policies/app-policy.json" with { type: "json" };

export const TAG_LIMIT = policy.praise.tags_per_praise_max;
export const TAG_LENGTH = policy.praise.tag_codepoints_max;
export const legacyTagNames = Object.fromEntries(policy.praise.tag_catalog.map(({ code, label }) => [code, label]));
export const tagIdentity = (name) => name.normalize("NFC").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
export function validTagName(name) {
  return typeof name === "string" && [...name.normalize("NFC")].length >= 1 &&
    [...name.normalize("NFC")].length <= TAG_LENGTH && /^[\p{L}\p{M}\p{N}_-]+$/u.test(name.normalize("NFC")) &&
    /[\p{L}\p{N}]/u.test(name.normalize("NFC"));
}
/** @returns {string[] | null} */
export function normalizePraiseTags(value) {
  if (!Array.isArray(value) || value.length > TAG_LIMIT) return null;
  const result = [];
  const seen = new Set();
  for (const name of value) {
    if (!validTagName(name)) return null;
    const normalized = name.normalize("NFC");
    const key = tagIdentity(normalized);
    if (!seen.has(key)) { seen.add(key); result.push(normalized); }
  }
  return result;
}
/** Consume completed #tokens; retain the first invalid token and everything after it. */
export function consumeTagInput(tags, input, flush = false) {
  const next = [...tags];
  let notice = "";
  for (const match of input.matchAll(/\S+/gu)) {
    const token = match[0];
    if (!flush && match.index + token.length === input.length) return { tags: next, input: token, error: "", notice };
    const name = token.slice(1).normalize("NFC");
    let error = "";
    if (!token.startsWith("#")) error = "태그는 #으로 시작해 주세요.";
    else if ([...name].length > TAG_LENGTH) error = `태그는 ${TAG_LENGTH}자까지 입력할 수 있어요.`;
    else if (!validTagName(name)) error = "# 뒤에 글자나 숫자를 입력해 주세요. 밑줄과 하이픈도 사용할 수 있어요.";
    else if (next.some((tag) => tagIdentity(tag) === tagIdentity(name))) { notice = "이미 추가한 태그예요."; continue; }
    else if (next.length >= TAG_LIMIT) error = `태그는 최대 ${TAG_LIMIT}개까지 추가할 수 있어요.`;
    if (error) return { tags: next, input: input.slice(match.index), error, notice };
    next.push(name);
    notice = `${name} 태그를 추가했어요.`;
  }
  return { tags: next, input: "", error: "", notice };
}
