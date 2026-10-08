import test from "node:test";
import assert from "node:assert/strict";
import { forceLoopbackPorts, assertLoopbackPorts } from "./docker-loopback-proxy.mjs";
const input = { Env: ["SYNTHETIC_SECRET=private-value"], HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "54322" }, { HostIp: "::", HostPort: "54322" }] } } };
test("Docker container creation binds every published port to loopback", () => {
  const result = forceLoopbackPorts("supabase_db_chagokchan", input);
  assert.ok(result.HostConfig.PortBindings["5432/tcp"].every((port) => port.HostIp === "127.0.0.1"));
});
test("port rewriting preserves private configuration without modifying the original", () => {
  const result = forceLoopbackPorts("supabase_db_chagokchan", input);
  assert.deepEqual(result.Env, input.Env);
  assert.equal(input.HostConfig.PortBindings["5432/tcp"][0].HostIp, "0.0.0.0");
});
test("Docker bridge rejects containers outside this project", () => assert.throws(() => forceLoopbackPorts("supabase_db_other", input)));
test("Docker bridge rejects malformed port configuration", () => assert.throws(() => forceLoopbackPorts("supabase_db_chagokchan", { HostConfig: { PortBindings: { "5432/tcp": [{}] } } })));
test("unpublished ports and internal services pass the runtime binding check", () => assert.doesNotThrow(() => assertLoopbackPorts({ "3000/tcp": null })));
test("runtime binding check rejects public IPv4 and IPv6", () => {
  for (const HostIp of ["0.0.0.0", "::", "192.168.1.1"]) assert.throws(() => assertLoopbackPorts({ "5432/tcp": [{ HostIp }] }));
});
test("runtime binding check accepts only loopback listeners", () => assert.doesNotThrow(() => assertLoopbackPorts({ "5432/tcp": [{ HostIp: "127.0.0.1" }, { HostIp: "::1" }] })));
