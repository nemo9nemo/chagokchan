import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const errors = [];
const checks = [];
const addError = (check, detail) => errors.push({ check, detail });
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const loadJson = (relative) => JSON.parse(read(relative));
const collect = (relative) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const next = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? collect(next) : [next];
  });
};
const files = [...new Set(["README.md", "AGENTS.md", ...collect("docs"), ...collect("contracts"), ...collect("policies")])];
const markdown = files.filter((file) => file.endsWith(".md"));
const jsonFiles = files.filter((file) => file.endsWith(".json"));
const json = new Map();
for (const file of jsonFiles) {
  try { json.set(file, loadJson(file)); } catch (error) { addError("json", file + ": " + error.message); }
}
checks.push({ id: "json", description: "JSON parse", count: jsonFiles.length });
let localLinks = 0;
for (const file of markdown) {
  for (const match of read(file).matchAll(/\[[^\]]+\]\(([^)\r\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const clean = target.split("#")[0];
    if (!clean) continue;
    localLinks += 1;
    if (!fs.existsSync(path.resolve(root, path.dirname(file), clean))) addError("links", file + " -> " + target);
  }
}
checks.push({ id: "links", description: "Local Markdown links", count: localLinks });
const policy = json.get("policies/app-policy.json");
const spec = json.get("contracts/openapi.json");
const tests = json.get("docs/quality/test-cases.json");
const registry = json.get("docs/development/artifact-register.json");
const development = json.get("policies/development-policy.json");
if (!policy || !spec || !tests || !registry) {
  addError("required", "Missing policy, OpenAPI, test cases, or artifact register");
}
const requirementText = read("docs/requirements/mvp-requirements.md");
const requirementIds = new Set([...requirementText.matchAll(/^\| ((?:REQ|NFR)-\d{3}) \|/gm)].map((m) => m[1]));
const policyIds = new Set();
for (const file of markdown) for (const match of read(file).matchAll(/^#{1,6} (POL-[A-Z]+-\d{3})/gm)) policyIds.add(match[1]);
const testIds = new Set();
for (const test of tests?.cases ?? []) {
  if (testIds.has(test.id)) addError("traceability", "Duplicate TC: " + test.id);
  testIds.add(test.id);
  for (const id of test.requirement_ids) if (!requirementIds.has(id)) addError("traceability", test.id + " unknown requirement " + id);
  for (const id of test.policy_ids) if (!policyIds.has(id)) addError("traceability", test.id + " unknown policy " + id);
  if (!test.steps?.length || !test.expected) addError("traceability", "Incomplete scenario " + test.id);
}
for (const id of requirementIds) if (!(tests?.cases ?? []).some((test) => test.requirement_ids.includes(id))) addError("traceability", "No TC for " + id);
const resolveRef = (ref) => {
  if (!ref.startsWith("#/")) { addError("openapi", "External reference requires separate validation: " + ref); return undefined; }
  let node = spec;
  for (const piece of ref.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!node || !Object.hasOwn(node, piece)) { addError("openapi", "Unresolved reference " + ref); return undefined; }
    node = node[piece];
  }
  return node;
};
let references = 0;
const visit = (node) => {
  if (!node || typeof node !== "object") return;
  if (node.$ref) { references += 1; resolveRef(node.$ref); }
  for (const value of Object.values(node)) visit(value);
};
visit(spec);
const operationIds = new Set();
let operations = 0;
const functionalApiRequirements = new Set();
for (const [route, item] of Object.entries(spec?.paths ?? {})) {
  for (const [method, operation] of Object.entries(item)) {
    if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) continue;
    operations += 1;
    if (!operation.operationId || operationIds.has(operation.operationId)) addError("openapi", "Missing/duplicate operationId " + route);
    operationIds.add(operation.operationId);
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map((param) => param.$ref ? resolveRef(param.$ref) : param).filter(Boolean);
    const inPath = [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const name of inPath) if (!parameters.some((param) => param.in === "path" && param.name === name && param.required === true)) addError("openapi", operation.operationId + " missing path parameter " + name);
    for (const param of parameters.filter((entry) => entry.in === "path")) if (!inPath.includes(param.name)) addError("openapi", operation.operationId + " unused path parameter " + param.name);
    if (method !== "get") {
      if (!parameters.some((param) => param.name === "X-CSRF-Token" && param.required)) addError("openapi", operation.operationId + " missing CSRF");
      if (!operation.requestBody?.required || !operation.requestBody.content?.["application/json"]) addError("openapi", operation.operationId + " missing JSON request contract");
    }
    if (!Object.keys(operation.responses ?? {}).some((status) => /^[23]\d\d$/.test(status))) addError("openapi", operation.operationId + " no success response");
    if (!operation["x-requirements"]?.length || !operation["x-test-cases"]?.length) addError("traceability", operation.operationId + " missing traceability");
    for (const id of operation["x-requirements"] ?? []) {
      if (!requirementIds.has(id)) addError("traceability", operation.operationId + " unknown requirement " + id);
      if (id.startsWith("REQ-")) functionalApiRequirements.add(id);
    }
    for (const id of operation["x-policy-ids"] ?? []) if (!policyIds.has(id)) addError("traceability", operation.operationId + " unknown policy " + id);
    for (const id of operation["x-test-cases"] ?? []) if (!testIds.has(id)) addError("traceability", operation.operationId + " unknown TC " + id);
  }
}
for (const id of requirementIds) if (id.startsWith("REQ-") && !functionalApiRequirements.has(id) && id !== "REQ-011") addError("traceability", "No API mapping for " + id);
checks.push({ id: "openapi", description: "Local refs, operation IDs, path parameters, mutation CSRF/JSON", count: operations, local_references: references });
checks.push({ id: "traceability", description: "REQ/NFR/POL/TC/API cross references", requirements: requirementIds.size, policies: policyIds.size, test_cases: testIds.size });

if (policy && spec) {
  const s = spec.components.schemas;
  const assertEqual = (actual, expected, label) => { if (actual !== expected) addError("policy_consistency", label); };
  assertEqual(spec["x-policy-version"], policy.policy_version, "OpenAPI policy version");
  assertEqual(s.BootstrapAccount.properties.registration_policy_version["x-current-version"], policy.policy_version, "Current signup policy version");
  assertEqual(s.BootstrapAccount.properties.adult_confirmed.const, true, "Explicit adult confirmation");
  for (const key of ["adult_confirmed", "registration_policy_version"]) if (!s.BootstrapAccount.required.includes(key)) addError("audience_consistency", "Bootstrap missing required " + key);
  assertEqual(spec.paths["/me/bootstrap"].post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/BootstrapAccount", "Bootstrap confirmation body");
  assertEqual(policy.audience.status, "confirmed", "Audience decision resolved");
  assertEqual(policy.audience.minimum_age_years, 19, "KR adult signup threshold");
  assertEqual(policy.audience.age_confirmation_method, "self_declaration", "Age confirmation method");
  for (const key of ["collect_exact_birth_date", "collect_phone_identity_verification", "collect_identity_document"]) assertEqual(policy.audience[key], false, "No unnecessary identity collection: " + key);
  for (const key of policy.audience.recorded_fields) if (!s.Me.required.includes(key) || !s.Me.properties[key].readOnly) addError("audience_consistency", "Self account missing read-only " + key);
  for (const name of ["MinimalProfile", "ContributorBoard", "PraiseContributor", "SentPraise"]) for (const key of policy.audience.recorded_fields) if (Object.hasOwn(s[name].properties, key)) addError("audience_consistency", name + " leaks " + key);
  if (!s.AuthResult.required.includes("account_state") || !s.AuthResult.properties.account_state.enum.includes("signup_required")) addError("audience_consistency", "Auth result missing signup state");
  if (!registry.resolved_inputs?.some((input) => input.id === "C01" && input.status === "confirmed") || registry.unresolved_inputs.some((input) => input.id === "C01")) addError("audience_consistency", "C01 remains unresolved");
  assertEqual(registry.verification.planned_test_cases, tests.cases.length, "Registry test count");
  assertEqual(s.TargetCount.minimum, policy.limits.target_count_min, "Target minimum");
  assertEqual(s.TargetCount.maximum, policy.limits.target_count_max, "Target maximum");
  assertEqual(s.TargetCount.default, policy.limits.default_target_count, "Target default");
  assertEqual(s.CreatePraise.properties.message.anyOf[0].maxLength, policy.limits.praise_message_codepoints_max, "Message length");
  assertEqual(s.Goal.properties.title.maxLength, policy.limits.title_codepoints_max, "Title length");
  assertEqual(spec.components.parameters.Limit.schema.maximum, policy.limits.page_size_max, "Page limit");
  assertEqual(spec.components.securitySchemes.cookieSession.name, policy.auth.cookie_base_name, "Cookie base name");
  assertEqual(JSON.stringify(s.UpdateMe.properties.avatar_key.enum), JSON.stringify(policy.profile.avatar_keys), "Avatar allowed keys");
  if (!s.TrashGoal.required.includes("revision")) addError("policy_consistency", "Trash restore requires revision in listing");
  for (const key of ["goal_id", "private_description", "personal_count", "members", "next_target_count"]) if (Object.hasOwn(s.ContributorBoard.properties, key)) addError("projection", "ContributorBoard leaks " + key);
  for (const name of ["PraiseContributor", "SentPraise"]) {
    for (const key of ["hidden_at", "excluded_at", "recipient_id", "recipient_user_id", "goal_id", "current_count"]) if (Object.hasOwn(s[name].properties, key)) addError("projection", name + " leaks " + key);
  }
  for (const name of ["PraiseOwner", "PraiseContributor", "SentPraise"]) if (!s[name].allOf?.length) addError("projection", name + " lacks canceled-body clearing constraint");
  const versionLine = read(".env.example").split("\n").find((line) => line.startsWith("APP_POLICY_VERSION="));
  assertEqual(versionLine, "APP_POLICY_VERSION=" + policy.policy_version, "Environment template policy version");
}
checks.push({ id: "policy_consistency", description: "Policy/API numeric values, names, restore fields" });
checks.push({ id: "projection", description: "Contributor/sent fields and canceled-body schema constraints" });
checks.push({ id: "audience_consistency", description: "Adult scope decision, signup input/state, self-only confirmation fields" });
const erdText = read("docs/data-erd.md");
const blocks = [...erdText.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1].trim());
const diagramFiles = ["data-erd-core.mmd", "data-erd-connections.mmd", "data-erd-operations.mmd"];
if (blocks.length !== diagramFiles.length) addError("erd_sources", "ERD embedded block count");
for (let i = 0; i < diagramFiles.length; i += 1) if (blocks[i] !== read("docs/diagrams/" + diagramFiles[i]).trim()) addError("erd_sources", "Embedded/source mismatch " + diagramFiles[i]);
const full = read("docs/diagrams/data-erd-full.mmd");
const entityNames = new Set([...full.matchAll(/^\s{4}(\w+) \{/gm)].map((m) => m[1]));
let relationships = 0;
for (const m of full.matchAll(/^\s{4}(\w+)\s+(\S+)\s+(\w+)\s*:/gm)) {
  relationships += 1;
  if (!entityNames.has(m[1]) || !entityNames.has(m[3])) addError("erd_sources", "Unknown entity relationship " + m[1] + " -> " + m[3]);
}
const goalsBlock = full.match(/    GOALS \{([\s\S]*?)\n    \}/)?.[1] ?? "";
if (!goalsBlock.includes("deleted_at") || !goalsBlock.includes("purge_after")) addError("erd_sources", "Missing goal deletion fields");
const appUserBlock = full.match(/    APP_USERS \{([\s\S]*?)\n    \}/)?.[1] ?? "";
for (const key of policy?.audience.recorded_fields ?? []) if (!appUserBlock.includes(key)) addError("audience_consistency", "ERD missing " + key);
checks.push({ id: "erd_sources", description: "Embedded/source consistency, full entities and relationship endpoints", embedded_blocks: blocks.length, entities: entityNames.size, relationships, rendered: false });

let registeredPaths = 0;
for (const artifact of registry?.artifacts ?? []) {
  if (artifact.status === "planned") continue;
  for (const file of artifact.paths) {
    registeredPaths += 1;
    const resolved = path.resolve(root, file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { addError("registry", "Outside workspace path " + file); continue; }
    if (!fs.existsSync(resolved)) addError("registry", "Missing artifact " + artifact.id + " " + file);
  }
}
checks.push({ id: "registry", description: "Existing registered artifact paths", count: registeredPaths });
const progressRows = read("docs/development/backlog.md").split("\n").filter((line) => /^\| W\d{2} \|/.test(line)).map((line) => line.split("|").map((cell) => cell.trim()));
const workIds = new Set();
for (const row of progressRows) {
  if (workIds.has(row[1])) addError("development_consistency", "Duplicate work item " + row[1]);
  workIds.add(row[1]);
  if (!development?.progress.statuses.includes(row[3])) addError("development_consistency", row[1] + " invalid status " + row[3]);
  if (row.length !== 8 || !row[5] || !row[6]) addError("development_consistency", row[1] + " missing completion criteria/evidence");
}
for (let i = 0; i <= 17; i += 1) if (!workIds.has("W" + String(i).padStart(2, "0"))) addError("development_consistency", "Missing work item W" + i);
for (const row of requirementText.split("\n").filter((line) => /^\| (?:REQ|NFR)-\d{3} \|/.test(line))) {
  const cells = row.split("|");
  if (cells.length !== 7) continue;
  for (const match of cells[5].matchAll(/W\d{2}/g)) if (!workIds.has(match[0])) addError("development_consistency", "Unknown requirement work item " + match[0]);
}
const environmentTemplate = read(".env.example");
if (!development || development.local_auth.interactive_login_required !== false || development.local_auth.use_same_business_rpc_and_rls !== true || development.local_auth.allow_service_role_for_business_requests !== false || development.local_auth.allow_client_supplied_actor_id !== false) addError("development_consistency", "Local actor/permission boundary policy");
if (development?.local_guard.required_app_env !== "local" || development?.local_guard.required_node_env !== "development" || development?.local_guard.required_loopback_binding !== true || development?.local_guard.reject_fixture_mode_in_release_build !== true || development?.deployed_auth.real_login_tests_required_before_public_release !== true) addError("development_consistency", "Local/release boundary policy");
if (!environmentTemplate.includes("APP_AUTH_MODE=" + development?.local_auth.mode + "\n") || !environmentTemplate.includes("LOCAL_DEV_ACTOR=" + development?.local_auth.default_actor + "\n")) addError("development_consistency", "Environment template/local policy mismatch");
if (development?.progress.source !== "docs/development/backlog.md" || registry.workspace?.progress_source !== development?.progress.source) addError("development_consistency", "Progress source mismatch");
if (registry.development_auth?.interactive_login_during_development !== false || registry.development_auth?.real_login_integration_and_tests !== "pre_release_required") addError("development_consistency", "Registry login schedule mismatch");
for (const id of ["TC-DEV-001", "TC-DEV-002"]) if (!testIds.has(id)) addError("development_consistency", "Missing planned scenario " + id);
if (registry.workspace?.transfer_status === "verified") {
  if (path.resolve(registry.workspace.canonical_path).toLowerCase() !== path.resolve(root).toLowerCase()) addError("development_consistency", "Verified workspace differs from execution root");
  const transfer = json.get(registry.workspace.transfer_record);
  if (!transfer?.source_hashes_matched_before_status_update || transfer.target !== registry.workspace.canonical_path) addError("development_consistency", "Missing matching workspace transfer evidence");
  if (progressRows.find((row) => row[1] === "W00")?.[3] !== "DONE") addError("development_consistency", "Verified transfer work item not DONE");
}
checks.push({ id: "development_consistency", description: "Development policy, local environment template, progress IDs/statuses, login schedule and transfer evidence", work_items: workIds.size, runtime_guards_executed: false });
const basisInputs = ["AGENTS.md", "policies/app-policy.json", "contracts/openapi.json", "docs/requirements/mvp-requirements.md", "docs/quality/test-cases.json", "docs/policies/product-rules.md", "docs/policies/data-lifecycle.md", "docs/policies/access-and-responses.md", "docs/policies/audience-and-signup.md", "docs/decisions/ADR-0002-adult-personal-audience.md", "docs/changes/2026-10-07-adult-audience.md", "docs/design/user-flows.md", "docs/contracts/api-contract.md", "docs/development/artifact-register.json", "docs/data-erd.md", ...diagramFiles.map((file) => "docs/diagrams/" + file), "docs/diagrams/data-erd-full.mmd", "scripts/verify-artifacts.mjs"].sort();
basisInputs.push(".env.example", "policies/development-policy.json", "docs/development/backlog.md", "docs/development/README.md", "docs/development/local-development.md", "docs/decisions/ADR-0004-local-development-auth.md");
basisInputs.sort();
const hash = crypto.createHash("sha256");
for (const file of basisInputs) { hash.update(file + "\0"); hash.update(read(file)); }
for (const check of checks) check.status = errors.some((error) => error.check === check.id) ? "failed" : "passed";
const result = {
  checked_at: new Date().toISOString(),
  status: errors.length ? "failed" : "passed",
  runtime: process.version,
  scope: "artifact_structural_consistency_only",
  full_openapi_validator_executed: false,
  mermaid_render_executed: false,
  application_or_database_tests_executed: 0,
  planned_test_cases: tests?.cases?.length ?? 0,
  checks,
  errors,
  basis: { inputs: basisInputs, format: "sorted_relative_paths_and_LF_normalized_UTF8_text", sha256: hash.digest("hex") }
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = errors.length ? 1 : 0;
