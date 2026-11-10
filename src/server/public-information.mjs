// Only explicitly configured public contact information may appear in pages.
// Do not fall back to a developer's Git, Google, or hosting account identity.
export function publicInformation(env = process.env) {
  const rawEmail = env.APP_SUPPORT_EMAIL ?? "";
  const rawName = env.APP_PUBLIC_OPERATOR_NAME ?? "";
  const email = typeof rawEmail === "string" && rawEmail.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(rawEmail) && !/\.(?:invalid|example|test)$/i.test(rawEmail) ? rawEmail : null;
  const operatorName = typeof rawName === "string" && rawName.trim().length > 0 && [...rawName].length <= 80 && ![...rawName].some(value => value.codePointAt(0) < 32 || value.codePointAt(0) === 127) ? rawName.trim() : null;
  return { email, operatorName, missingContactFields: [!email && "support_email", !operatorName && "public_operator_name"].filter(Boolean) };
}
