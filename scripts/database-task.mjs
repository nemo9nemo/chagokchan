import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertLocalDatabase, projectRoot, sql, supabaseCli } from "./local-database-tools.mjs";

const action = process.argv[2];
try {
  if (!["migrate", "test"].includes(action)) throw new Error("Unsupported local database task.");
  assertLocalDatabase();
  if (action === "migrate") {
    // The CLI is explicitly local. Automatic seed remains disabled.
    supabaseCli(["migration", "up", "--local"]);
    const versions = sql("select version from supabase_migrations.schema_migrations order by version;\n").trim().split("\n").filter(Boolean);
    process.stdout.write(JSON.stringify({ status: "applied", target: "local", migrations: versions }) + "\n");
  } else {
    const files = fs.readdirSync(path.join(projectRoot, "supabase/tests")).filter((file) => file.endsWith(".test.sql")).sort();
    if (!files.length) throw new Error("No database tests found.");
    const suites = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(projectRoot, "supabase/tests", file), "utf8");
      const output = sql(source);
      const plan = Number(output.match(/^1\.\.(\d+)$/m)?.[1]);
      const passed = (output.match(/^ok \d+(?:\s|$)/gm) ?? []).length;
      const failed = (output.match(/^not ok \d+(?:\s|$)/gm) ?? []).length;
      const valid = plan > 0 && passed === plan && failed === 0 && !/^Bail out!/m.test(output);
      suites.push({ file, sha256: crypto.createHash("sha256").update(source).digest("hex"), executed: passed + failed, passed, failed, planned: plan, status: valid ? "passed" : "failed" });
      if (!valid) { process.stdout.write(output); throw new Error("Database assertions failed."); }
    }
    const report = { verified_at: new Date().toISOString(), scope: "physical_schema_and_initial_access_only", status: "passed", suites, executed: suites.reduce((sum, suite) => sum + suite.executed, 0), business_rpc_tests_executed: 0, real_login_tests_executed: 0 };
    fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "tmp/data-db-tests.json"), JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
} catch {
  process.stderr.write("Local database " + action + " failed. Check the local setup and SQL assertion output; raw command output is withheld.\n");
  process.exitCode = 1;
}
