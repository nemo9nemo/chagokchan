import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Never echo scanner output: reports can contain source lines, author emails,
// or credential values. Publish only counts and finding locations.
export function scanSecrets(executable = "gitleaks") {
  const version = spawnSync(executable, ["version"], { encoding: "utf8", windowsHide: true });
  if (version.status !== 0 || version.stdout.trim() !== "8.30.1") throw new Error("Use the pinned Gitleaks 8.30.1 scanner.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chagokchan-secret-scan-"));
  const report = path.join(directory, "redacted.json");
  try {
    const result = spawnSync(executable, ["git", "--log-opts=--all", "--redact=100", "--report-format=json", `--report-path=${report}`, "--no-banner", "--log-level=fatal", "."], { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    if (result.error || ![0, 1].includes(result.status) || !fs.existsSync(report)) throw new Error("Secret scanning did not complete; raw output withheld.");
    const findings = JSON.parse(fs.readFileSync(report, "utf8"));
    if (!Array.isArray(findings)) throw new Error("Invalid secret scan report.");
    const summary = { scanner: "gitleaks", version: "8.30.1", scope: "all_locally_reachable_git_refs", status: result.status === 0 && findings.length === 0 ? "passed" : "failed", findings: findings.map(item => ({ rule: item.RuleID, file: item.File, line: item.StartLine, commit: item.Commit })), values_and_author_emails_displayed: false };
    return summary;
  } finally {
    // Only remove the exact report we created and its now-empty temporary dir.
    if (fs.existsSync(report)) fs.unlinkSync(report);
    fs.rmdirSync(directory);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const report = scanSecrets(process.argv[2]); process.stdout.write(JSON.stringify(report, null, 2) + "\n"); if (report.status !== "passed") process.exitCode = 1; }
  catch { process.stderr.write("Secret scanning unavailable; raw output withheld.\n"); process.exitCode = 1; }
}
