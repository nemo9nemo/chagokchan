import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, csrfSessionBinding, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import { sealSession, SESSION_COOKIE_NAME } from "../src/server/deployed-session.mjs";
import { logoutResponse } from "../src/server/logout-api.mjs";

const now = Date.now();
const userId = "11111111-1111-4111-8111-111111111111";
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://auth-test.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only", CSRF_SIGNING_SECRET: "logout-test-signing-material-at-least-32-bytes", AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32,31).toString("base64url") };
const payload = Buffer.from(JSON.stringify({ sub: userId, session_id: "22222222-2222-4222-8222-222222222222", role: "authenticated", exp: Math.floor(now/1000)+600 })).toString("base64url");
const tokens = { access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".testsignature", refresh_token: "test-refresh-token" };
const cookie = `${SESSION_COOKIE_NAME}=${sealSession(tokens,env,now)}`;
function request(body = {}, { header = cookie, origin = env.APP_BASE_URL, csrf = true, modeEnv = env } = {}) {
  const binding = modeEnv.APP_AUTH_MODE === "supabase_session" ? csrfSessionBinding(new Request(env.APP_BASE_URL,{headers:{cookie:header}})) : null;
  const value = createCsrfToken(modeEnv.APP_AUTH_MODE === "local_fixture" ? modeEnv.APP_LOCAL_CSRF_SIGNING_SECRET : env.CSRF_SIGNING_SECRET,Date.now(),binding);
  return new Request(env.APP_BASE_URL+"/api/v1/auth/logout",{method:"POST",headers:{origin,"content-type":"application/json",cookie:header+`; ${CSRF_COOKIE_NAME}=${value}`,...(csrf?{"x-csrf-token":value}:{})},body:JSON.stringify(body)});
}
function fixture({ contextError, revokeError, userError, contextState = "active", contextData } = {}) {
  const calls=[];
  const clientFactory = (_url,key) => {
    assert.equal(key,env.SUPABASE_PUBLISHABLE_KEY);
    return { auth:{ getUser:async jwt => {calls.push(["verify",jwt]);return userError?{error:userError}:{data:{user:{id:userId,is_anonymous:false}}};},admin:{signOut:async (jwt,scope)=>{calls.push(["revoke",jwt,scope]);return {error:revokeError};}} },
      rpc:async name=>{calls.push(["rpc",name]);return contextError?{error:contextError}:{data:contextData??{user_id:userId,account_state:contextState,next:{active:"/",signup_required:"/signup",deleting:"/account/deletion"}[contextState]}};} };
  };
  return { calls, options:{env,clientFactory,now} };
}
for(const [scope,expected] of [["current","local"],["all","global"]]) {
  test(`${scope} logout uses the verified user JWT and removes Auth/CSRF cookies after revocation`,async()=>{
    const {calls,options}=fixture();const response=await logoutResponse(request({scope}),options);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.deepEqual(calls.at(-1),["revoke",tokens.access_token,expected]);
    assert.equal(calls.filter(([kind])=>kind==="rpc").length,1);
    const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);
    for(const value of cookies)assert.match(value,/Max-Age=0; Secure; HttpOnly; SameSite=Lax/);
    assert.match(response.headers.get("cache-control"),/no-store/);
  });
}
test("empty input defaults to current and unknown/null scopes cannot call Auth",async()=>{
  const {calls,options}=fixture();assert.equal((await logoutResponse(request(),options)).status,200);assert.equal(calls.at(-1)[2],"local");
  for(const body of [{scope:"others"},{scope:null},{user_id:userId},{scope:"current",token:"untrusted"}]){
    const f=fixture();assert.equal((await logoutResponse(request(body),f.options)).status,400);assert.equal(f.calls.length,0);
  }
});
test("foreign origin or missing CSRF cannot reach Auth or clear cookies",async()=>{
  for(const flags of [{origin:"https://foreign.example.invalid"},{csrf:false}]){
    const {calls,options}=fixture();const response=await logoutResponse(request({},flags),options);
    assert.equal(response.status,403);assert.equal(response.headers.getSetCookie().length,0);assert.equal(calls.length,0);
  }
});
test("signed-out current request clears the browser but cannot claim all-session revocation",async()=>{
  const {calls,options}=fixture();assert.equal((await logoutResponse(request({},{header:""}),options)).status,200);
  assert.equal((await logoutResponse(request({scope:"all"},{header:""}),options)).status,401);assert.equal(calls.length,0);
});
test("local fixture logout is disabled and cannot invalidate the development session",async()=>{
  const local={...env,APP_AUTH_MODE:"local_fixture",APP_LOCAL_CSRF_SIGNING_SECRET:"local-test-signing-material-at-least-32-bytes"};
  const {calls,options}=fixture();const response=await logoutResponse(request({},{modeEnv:local}),{...options,env:local});
  assert.equal(response.status,409);assert.equal(response.headers.getSetCookie().length,0);assert.equal(calls.length,0);
});
test("revoked DB session cannot revoke all other sessions with an unexpired JWT",async()=>{
  const {calls,options}=fixture({contextError:{code:"PT401"}});const response=await logoutResponse(request({scope:"all"}),options);
  assert.equal(response.status,401);assert.equal(response.headers.getSetCookie().length,0);assert.equal(calls.some(([kind])=>kind==="revoke"),false);
});
test("current logout retries can clean up a DB-ended session confirmed by Auth",async()=>{
  const {options}=fixture({contextError:{code:"PT401"},revokeError:{status:401}});
  const response=await logoutResponse(request(),options);assert.equal(response.status,200);assert.equal(response.headers.getSetCookie().length,2);
});
test("Auth/DB failures retain cookies and return bounded dependency errors",async()=>{
  for(const config of [{revokeError:{status:503,message:"secret provider text"}},{contextError:{code:"PT503",message:"secret database text"}},{userError:{status:500,message:"secret identity text"}},{contextData:{user_id:userId,account_state:"active",next:"/",email:"secret profile text"}}]){
    const {options}=fixture(config);const response=await logoutResponse(request(),options);
    assert.equal(response.status,503);assert.equal(response.headers.getSetCookie().length,0);assert.equal(JSON.stringify(await response.json()).includes("secret"),false);
  }
});
test("expired access tokens cannot silently clear a possibly live refresh-session cookie",async()=>{
  const {calls,options}=fixture();const response=await logoutResponse(request(),{...options,now:now+601000});
  assert.equal(response.status,401);assert.equal(response.headers.getSetCookie().length,0);assert.equal(calls.length,0);
});
test("signup-required and deleting Auth accounts can revoke their own live sessions",async()=>{
  for(const contextState of ["signup_required","deleting"]){const {options}=fixture({contextState});assert.equal((await logoutResponse(request(),options)).status,200);}
});
