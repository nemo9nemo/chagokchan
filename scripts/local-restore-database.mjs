import crypto from "node:crypto";
import { assertLocalDatabase, databaseContainer, runQuiet, sql } from "./local-database-tools.mjs";

// Disposable local restore target only. No arbitrary host, source or target input.
export class LocalRestoreDatabase {
  #name; #label; #created = false;
  constructor() {
    assertLocalDatabase();
    this.#name = `chagokchan_restore_${crypto.randomUUID().replaceAll("-", "")}`;
    this.#label = `chagokchan/isolated-restore/v1/${crypto.randomUUID()}`;
  }
  #guard() { if (!/^chagokchan_restore_[0-9a-f]{32}$/.test(this.#name)) throw new Error("Unsafe restore target."); }
  async create() {
    this.#guard();
    if (this.#created) throw new Error("Restore target already created.");
    sql('create database :"target" template template0;\n', { target: this.#name });
    this.#created = true;
    sql('comment on database :"target" is :\'label\';\n', { target: this.#name, label: this.#label });
  }
  query(statement, variables = {}) {
    this.#guard(); if (!this.#created) throw new Error("Restore target not created.");
    const args = ["exec", "-i", databaseContainer, "psql", "-X", "-U", "supabase_admin", "-d", this.#name, "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
    for (const [key, value] of Object.entries(variables)) {
      if (!/^[a-z_]+$/.test(key) || typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Invalid restore variable.");
      args.push("-v", key + "=" + value);
    }
    return runQuiet("docker", [...args, "-f", "-"], { input: statement });
  }
  dumpSource() {
    this.#guard();
    // Includes schema, table data, Auth and migration metadata. Cluster roles are
    // already present in this disposable local cluster; no pg_dumpall globals.
    const archive = runQuiet("docker", ["exec", databaseContainer, "pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom"], { encoding: null, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (!Buffer.isBuffer(archive) || archive.subarray(0, 5).toString() !== "PGDMP") throw new Error("Invalid local backup archive.");
    return archive;
  }
  restore(archive) {
    this.#guard(); if (!this.#created || !Buffer.isBuffer(archive) || archive.length > 64 * 1024 * 1024 || archive.subarray(0, 5).toString() !== "PGDMP") throw new Error("Invalid local restore.");
    // All restore work rolls back on error; never restore over the source DB.
    // The local existing cluster administrator can restore the original NOLOGIN
    // function/table owners without granting source postgres SET ROLE rights or
    // weakening ownership with --no-owner. It never targets the source database.
    runQuiet("docker", ["exec", "-i", databaseContainer, "pg_restore", "-U", "supabase_admin", "-d", this.#name, "--single-transaction", "--exit-on-error"], { input: archive, encoding: null, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  }
  drop() {
    this.#guard(); if (!this.#created) return;
    const actual = sql("select shobj_description(oid,'pg_database') from pg_database where datname=:'target';\n", { target: this.#name }).trim();
    if (actual !== this.#label) throw new Error("Restore target ownership marker changed; refusing cleanup.");
    sql('drop database :"target";\n', { target: this.#name }); this.#created = false;
  }
}
