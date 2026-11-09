"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { authMutation, clearCsrfToken, runAuthChange, sessionMutationFetch } from "@/client/auth-session";
import { broadcastSignedOut } from "@/client/auth-broadcast";

type Mode = "login" | "signup" | "refresh" | "unavailable" | "deleting";
async function failureMessage(response: Response) {
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function LogoutButtons({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout(scope: "current" | "all") {
    setBusy(true); setError("");
    try {
      await runAuthChange(async () => {
        clearCsrfToken();
        const response = await authMutation("/api/v1/auth/logout", { scope });
        if (!response.ok) throw new Error(await failureMessage(response));
        clearCsrfToken();
        broadcastSignedOut();
        window.location.replace("/");
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그아웃하지 못했어요."); setBusy(false); }
  }
  return <div className={compact ? "auth-actions auth-actions-compact" : "auth-actions"}>
    <button type="button" disabled={busy} onClick={() => void logout("current")}>{busy ? "처리 중…" : "로그아웃"}</button>
    {!compact && <button type="button" disabled={busy} onClick={() => void logout("all")}>모든 기기에서 로그아웃</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function AccountMenu() {
  return <details className="account-menu"><summary>계정</summary><div className="account-menu-panel"><LogoutButtons /></div></details>;
}

export default function AuthScreen({ mode, policyVersion = "0.2.0", next = "/" }: { mode: Mode; policyVersion?: string; next?: "/" | "/connect" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const invite = useRef<string | null>(null);
  const startedRefresh = useRef(false);
  useEffect(() => {
    const fragment = window.location.hash;
    if (fragment) {
      window.history.replaceState(null, "", window.location.pathname);
      const match = /^#invite=([A-Za-z0-9_-]{32})$/.exec(fragment);
      if (match) invite.current = match[1];
      else if (next === "/connect") setError("초대 링크가 올바르지 않아요. 초대 코드를 입력하거나 새 링크를 받아 주세요.");
    }
    const query = new URLSearchParams(window.location.search);
    if (query.has("auth_error")) {
      window.history.replaceState(null, "", window.location.pathname);
      setError(query.get("auth_error") === "unavailable" ? "인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." : "로그인을 완료하지 못했어요. 다시 시작해 주세요.");
    }
  }, [next]);

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      await runAuthChange(async () => {
        clearCsrfToken();
        const response = await authMutation("/api/v1/auth/refresh");
        if (!response.ok) throw new Error(await failureMessage(response));
        clearCsrfToken(); window.location.reload();
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인을 갱신하지 못했어요."); setBusy(false); }
  }, []);
  useEffect(() => {
    if (mode === "refresh" && !startedRefresh.current) { startedRefresh.current = true; void refresh(); }
  }, [mode, refresh]);

  async function login() {
    setBusy(true); setError("");
    try {
      await runAuthChange(async () => {
        clearCsrfToken();
        const response = await authMutation("/api/v1/auth/google/start", { next, ...(invite.current ? { invite_token: invite.current } : {}) });
        if (!response.ok) throw new Error(await failureMessage(response));
        const data = await response.json() as { authorization_url: string };
        window.location.assign(data.authorization_url);
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인을 시작하지 못했어요."); setBusy(false); }
  }

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true); setError("");
    try {
      const response = await sessionMutationFetch("/api/v1/me/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adult_confirmed: true, registration_policy_version: policyVersion }) });
      if (!response.ok) throw new Error(await failureMessage(response));
      window.location.replace("/connect");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "가입을 완료하지 못했어요."); setBusy(false); }
  }

  return <main className="auth-shell"><a className="brand-lockup" href="/"><span className="brand-name">차곡찬</span></a>
    <section className="content-card auth-card" aria-labelledby="auth-heading" aria-busy={busy}>
      <p className="eyebrow">작은 수고를 알아보는 시간</p>
      <h1 id="auth-heading">{mode === "signup" ? "시작하기 전에 확인해 주세요" : mode === "deleting" ? "계정 삭제를 진행하고 있어요" : mode === "refresh" ? "로그인을 확인하고 있어요" : mode === "unavailable" ? "잠시 연결이 어려워요" : "나에게 칭찬을 차곡차곡"}</h1>
      {mode === "login" && <><p>목표를 정하고, 오늘의 작은 수고를 칭찬으로 남겨 보세요. 공유할 목표는 직접 선택할 수 있어요.</p><p>만 19세 이상 개인 사용자를 위한 초기 베타예요.</p><button className="button button-primary button-wide" type="button" disabled={busy} onClick={() => void login()}>{busy ? "Google로 이동 중…" : "Google로 계속하기"}</button></>}
      {mode === "signup" && <form className="stack-form" onSubmit={signup}><p>차곡찬은 만 19세 이상 성인만 이용할 수 있어요. 생년월일이나 신분증은 수집하지 않아요.</p><label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>만 19세 이상입니다.</span></label><p className="field-hint"><a href="/privacy">개인정보 처리방침</a>과 <a href="/terms">이용 안내</a>를 확인해 주세요.</p><button className="button button-primary" type="submit" disabled={!confirmed || busy}>{busy ? "가입 처리 중…" : "확인하고 시작하기"}</button></form>}
      {mode === "refresh" && <><p>안전하게 계정을 확인한 뒤 사용하던 화면으로 돌아갑니다.</p>{error && <button type="button" disabled={busy} onClick={() => void refresh()}>다시 확인하기</button>}</>}
      {mode === "unavailable" && <><p>계정 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" onClick={() => window.location.reload()}>다시 연결하기</button></>}
      {mode === "deleting" && <p>탈퇴 요청 후에는 기록에 접근하거나 탈퇴를 취소할 수 없어요. 삭제가 완료된 뒤 새 계정으로 다시 시작할 수 있어요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {error && mode === "signup" && <a href="/signup">가입 안내 다시 불러오기</a>}
      {["signup", "refresh", "deleting"].includes(mode) && <LogoutButtons />}
    </section>
    <footer className="auth-footer"><a href="/privacy">개인정보 처리방침</a><a href="/terms">이용 안내</a></footer>
  </main>;
}
