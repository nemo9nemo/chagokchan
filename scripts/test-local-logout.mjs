import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { createCsrfToken, csrfSessionBinding, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import { sealSession, SESSION_COOKIE_NAME } from "../src/server/deployed-session.mjs";
import { logoutResponse } from "../src/server/logout-api.mjs";

const runId = crypto.randomUUID();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://logout-test.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_transport_only", CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url"), AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };
const cases=[];
let admin, before, beforeSessions, beforeUsers, failure;
let phase="setup";
let preserved=false;
let issued=0;
const sessions=()=>sql("select id from auth.sessions order by id;\n").trim();
function snapshot(){
  const tables=sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n");
  assert.equal(tables.length,18);const hash=crypto.createHash("sha256");
  for(const table of tables){assert.match(table,/^[a-z_]+$/);hash.update(table+"\0"+sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`));}
  return hash.digest("hex");
}
async function record(name,work){phase=name;await work();cases.push({name,status:"passed"});}
try{
  const status=assertLocalDatabase();before=snapshot();beforeSessions=sessions();beforeUsers=Number(sql("select count(*) from auth.users;\n"));
  const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
  admin=createClient(status.API_URL,status.SECRET_KEY??status.SERVICE_ROLE_KEY,options);
  const identities=[];
  for(const label of ["one","two"]){
    const credentials={email:`${label}-${runId}@logout.chagokchan.invalid`,password:crypto.randomBytes(32).toString("base64url")};
    const result=await admin.auth.admin.createUser({...credentials,email_confirm:true,app_metadata:{local_logout_run:runId}});
    assert.equal(result.error,null);identities.push({...credentials,id:result.data.user.id});
  }
  const signIn=async identity=>{const client=createClient(status.API_URL,key,options);const result=await client.auth.signInWithPassword({email:identity.email,password:identity.password});assert.equal(result.error,null);assert.equal(result.data.user.id,identity.id);issued++;return {client,tokens:result.data.session};};
  const a1=await signIn(identities[0]),a2=await signIn(identities[0]),b1=await signIn(identities[1]);
  const clientFactory=(_url,_key,config)=>createClient(status.API_URL,key,config);
  function request(probe,scope="current",origin=env.APP_BASE_URL){
    const cookie=probe?`${SESSION_COOKIE_NAME}=${sealSession(probe.tokens,env)}`:"";
    const binding=csrfSessionBinding(new Request(env.APP_BASE_URL,{headers:{cookie}}));
    const csrf=createCsrfToken(env.CSRF_SIGNING_SECRET,Date.now(),binding);
    return new Request(env.APP_BASE_URL+"/api/v1/auth/logout",{method:"POST",headers:{origin,"content-type":"application/json",cookie:cookie+`; ${CSRF_COOKIE_NAME}=${csrf}`,"x-csrf-token":csrf},body:JSON.stringify({scope})});
  }
  const invoke=(probe,scope,origin)=>logoutResponse(request(probe,scope,origin),{env,clientFactory});
  const live=async probe=>assert.equal((await probe.client.rpc("get_auth_context")).error,null);
  const ended=async probe=>assert.equal((await probe.client.rpc("get_auth_context")).error?.code,"PT401");
  await record("cross_origin_cannot_revoke_an_issued_session",async()=>{assert.equal((await invoke(a1,"current","https://foreign.example.invalid")).status,403);await live(a1);await live(a2);});
  await record("current_revokes_only_current_issued_session",async()=>{const response=await invoke(a1,"current");assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(response.headers.getSetCookie().length,2);assert.match(response.headers.get("cache-control"),/no-store/);await ended(a1);await live(a2);await live(b1);});
  await record("revoked_cookie_cannot_log_out_other_devices",async()=>{assert.equal((await invoke(a1,"all")).status,401);await live(a2);await live(b1);});
  const a3=await signIn(identities[0]);
  await record("all_revokes_own_multiple_sessions_and_preserves_other_user",async()=>{assert.equal((await invoke(a2,"all")).status,200);await ended(a2);await ended(a3);await live(b1);});
  await record("signed_out_current_is_idempotent_all_requires_identity",async()=>{assert.equal((await invoke(null,"current")).status,200);assert.equal((await invoke(null,"all")).status,401);await live(b1);});
}catch{failure=phase;process.stderr.write("Local logout check failed at "+phase+"; raw credentials and responses withheld.\n");}
finally{
  try{
    if(admin){
      const ids=sql("select id from auth.users where raw_app_meta_data->>'local_logout_run'=:'run' order by id;\n",{run:runId}).trim().split("\n").filter(Boolean);
      for(const id of ids){assert.match(id,/^[0-9a-f-]{36}$/);const user=await admin.auth.admin.getUserById(id);assert.equal(user.data.user.app_metadata.local_logout_run,runId);assert.equal((await admin.auth.admin.deleteUser(id)).error,null);}
    }
    if(before){preserved=snapshot()===before&&sessions()===beforeSessions&&Number(sql("select count(*) from auth.users;\n"))===beforeUsers;assert.ok(preserved);cases.push({name:"existing_product_rows_auth_users_and_sessions_preserved",status:"passed"});}
  }catch{failure??="cleanup";}
}
const report={checked_at:new Date().toISOString(),status:!failure&&preserved?"passed":"failed",failed_phase:failure??null,executed:cases.length,cases,real_local_sessions_issued:issued,synthetic_auth_users_created:2,existing_product_data_auth_users_and_sessions_preserved:preserved,local_admin_used_only_for_test_identity_setup_cleanup:true,service_role_used_for_application_requests:false,real_google_otp_tests_executed:0,production_transport_or_browser_tested:false};
fs.writeFileSync("tmp/w12-c1-logout-local.json",JSON.stringify(report,null,2)+"\n");process.stdout.write(JSON.stringify(report)+"\n");
if(report.status!=="passed")process.exitCode=1;
