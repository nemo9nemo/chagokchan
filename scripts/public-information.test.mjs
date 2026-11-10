import assert from "node:assert/strict";
import test from "node:test";
import { publicInformation } from "../src/server/public-information.mjs";

test("public contact never falls back to private provider, Git or developer identity", () => {
  assert.deepEqual(publicInformation({ EMAIL: "private@example.org", GIT_AUTHOR_EMAIL: "private@example.org", VERCEL_GIT_COMMIT_AUTHOR_LOGIN: "private-owner" }), { email: null, operatorName: null, missingContactFields: ["support_email", "public_operator_name"] });
});
test("only explicit public contact is returned and cannot inject mail headers", () => {
  const info = publicInformation({ APP_SUPPORT_EMAIL: "help+chagokchan@example.org", APP_PUBLIC_OPERATOR_NAME: "공통 운영팀" });
  assert.equal(info.email, "help+chagokchan@example.org"); assert.deepEqual(info.missingContactFields, []);
  for (const value of ["help@example.org\r\nBcc:private@example.org", "help@example.org?subject=malicious", "help@placeholder.invalid", "mailto:help@example.org", " help@example.org", "help@example.org#data"]) assert.equal(publicInformation({ APP_SUPPORT_EMAIL: value }).email, null);
});
test("operator values are bounded and remain absent until explicitly configured", () => {
  for (const value of ["", " ", "a".repeat(81), "owner\nprivate"]) assert.equal(publicInformation({ APP_PUBLIC_OPERATOR_NAME: value }).operatorName, null);
  assert.equal(publicInformation({ APP_PUBLIC_OPERATOR_NAME: "  운영팀  " }).operatorName, "운영팀");
});
