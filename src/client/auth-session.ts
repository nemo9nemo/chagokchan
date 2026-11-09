"use client";

let csrfToken: string | null = null;
let csrfFetchedAt = 0;
let pendingCsrf: Promise<string> | null = null;
let recovering: Promise<boolean> | null = null;
let authQueue: Promise<unknown> = Promise.resolve();

export function clearCsrfToken() { csrfToken = null; csrfFetchedAt = 0; }

export async function getCsrfToken(): Promise<string> {
  if (csrfToken && Date.now() - csrfFetchedAt < 7 * 60 * 1000) return csrfToken;
  if (!pendingCsrf) {
    pendingCsrf = fetch("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" }).then(async response => {
      if (!response.ok) throw new Error("요청을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
      const data = await response.json() as { csrf_token?: string };
      if (typeof data.csrf_token !== "string") throw new Error("요청을 준비하지 못했어요.");
      csrfToken = data.csrf_token; csrfFetchedAt = Date.now();
      return csrfToken;
    }).finally(() => { pendingCsrf = null; });
  }
  return pendingCsrf;
}

export async function authMutation(path: string, body: Record<string, unknown> = {}) {
  clearCsrfToken();
  const token = await getCsrfToken();
  return fetch(path, { method: "POST", cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify(body) });
}

export async function runAuthChange<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("chagokchan-auth-session", action);
  const result = authQueue.then(action, action);
  authQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function recoverUnlocked() {
  const current = await fetch("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (current.ok) { clearCsrfToken(); return true; }
  if (current.status !== 401) return false;
  const response = await authMutation("/api/v1/auth/refresh");
  clearCsrfToken();
  return response.ok;
}

async function recoverSession() {
  if (!recovering) {
    recovering = runAuthChange(recoverUnlocked).finally(() => { recovering = null; });
  }
  return recovering;
}

export async function sessionMutationFetch(path: string, init: RequestInit) {
  return runAuthChange(async () => {
    // Serialize CSRF preparation and the mutation across tabs. A token prepared
    // before a different tab's cookie rotation must never be reused.
    clearCsrfToken();
    const headers = new Headers(init.headers);
    headers.set("X-CSRF-Token", await getCsrfToken());
    let response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 && await recoverUnlocked()) {
      headers.set("X-CSRF-Token", await getCsrfToken());
      response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
    }
    return response;
  });
}

export async function sessionFetch(path: string, init: RequestInit = {}) {
  let response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (response.status === 401 && !path.startsWith("/api/v1/auth/") && await recoverSession()) {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET") headers.set("X-CSRF-Token", await getCsrfToken());
    response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  }
  return response;
}
