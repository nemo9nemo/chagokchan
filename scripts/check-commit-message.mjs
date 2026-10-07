import fs from "node:fs";
const filename = process.argv[2];
if (!filename) throw new Error("Commit message file is required.");
const message = fs.readFileSync(filename, "utf8");
const title = message.split(/\r?\n/, 1)[0];
const required = ["작업", "이유", "검증", "참조"];
const missing = required.filter((label) => !new RegExp("^" + label + ":\\s*\\S.+", "m").test(message));
if (!/^(feat|fix|chore|docs|test|refactor)\([a-z0-9-]+\):\s+.{5,}$/.test(title) || missing.length) {
  process.stderr.write("Commit rejected: use type(scope): purpose and nonempty 작업/이유/검증/참조 sections.\n");
  process.exitCode = 1;
}
