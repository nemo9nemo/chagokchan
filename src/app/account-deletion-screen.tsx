"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { clearCsrfToken, sessionMutationFetch } from "@/client/auth-session";
import { broadcastSignedOut } from "@/client/auth-broadcast";
import { LogoutButtons } from "./auth-screen";

type Grant = { grant_id: string; expires_at: string };
async function message(response: Response) {
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.";
}

export function DeletionAcceptedScreen() {
  return <main className="auth-shell"><a className="brand-lockup" href="/"><span className="brand-name">차곡찬</span></a><section className="content-card auth-card" aria-labelledby="deletion-heading">
    <h1 id="deletion-heading">계정 삭제 요청을 접수했어요</h1>
    <p>기록 접근을 차단했어요. 탈퇴를 취소하거나 예전 기록을 다시 열 수 없어요.</p>
    <p>데이터 삭제를 진행하고 있어요. 이 안내는 삭제 완료를 뜻하지 않아요.</p>
    <a href="/privacy">개인정보 처리방침</a>
  </section></main>;
}

export default function AccountDeletionScreen() {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const requestKey = useRef<string | null>(null);
  const initialQuery = useRef<string | null>(null);
  useEffect(() => {
    if (initialQuery.current === null) {
      initialQuery.current = window.location.search;
      window.history.replaceState(null, "", "/account/deletion");
    }
    const query = new URLSearchParams(initialQuery.current);
    const flowId = query.get("flow"); let active = true;
    if (query.has("reauth_error")) setError(query.get("reauth_error") === "account_mismatch" ? "다른 Google 계정을 선택했어요. 삭제할 계정과 같은 계정으로 다시 확인해 주세요." : "재인증을 완료하지 못했어요. 다시 시작해 주세요.");
    if (!flowId) { setChecking(false); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/auth/reauth/${encodeURIComponent(flowId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await message(response));
        const data = await response.json() as Grant & { status: string };
        if (data.status !== "verified" || !data.grant_id || !Number.isFinite(Date.parse(data.expires_at))) throw new Error("재인증이 만료됐어요. Google로 다시 확인해 주세요.");
        if (active) setGrant({ grant_id: data.grant_id, expires_at: data.expires_at });
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "재인증 결과를 확인하지 못했어요."); }
      finally { if (active) setChecking(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!grant) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(grant.expires_at) - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [grant]);

  async function reauthenticate() {
    setBusy(true); setError(""); setGrant(null); setConfirmed(false); requestKey.current = null;
    try {
      const response = await sessionMutationFetch("/api/v1/auth/reauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", scope: "account.delete" }) });
      if (!response.ok) throw new Error(await message(response));
      const data = await response.json() as { authorization_url: string };
      clearCsrfToken(); window.location.assign(data.authorization_url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "재인증을 시작하지 못했어요."); setBusy(false); }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!confirmed || !grant || remaining <= 0 || busy) return;
    setBusy(true); setError(""); requestKey.current ??= crypto.randomUUID();
    try {
      const response = await sessionMutationFetch("/api/v1/account/deletion-requests", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current }, body: JSON.stringify({ confirm: true, reauth_grant_id: grant.grant_id }) });
      if (response.status !== 202) throw new Error(await message(response));
      clearCsrfToken(); broadcastSignedOut(); window.location.replace("/account/deletion");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "삭제 접수 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요."); setBusy(false); }
  }
  return <main className="auth-shell"><a className="brand-lockup" href="/"><span className="brand-name">차곡찬</span></a><section className="content-card auth-card" aria-labelledby="deletion-heading" aria-busy={busy || checking}>
    <h1 id="deletion-heading">계정 삭제</h1>
    <p>계정을 삭제하면 기록 접근이 즉시 차단돼요. 탈퇴 취소와 기록 복구는 할 수 없어요.</p>
    <p>내 목표와 기록은 삭제 대상이에요. 다른 사람에게 보낸 칭찬은 작성자 정보와 본문을 지우고 상대의 칭찬 개수에 반영된 결과만 남겨요.</p>
    <p>먼저 현재 계정과 같은 Google 계정으로 확인해 주세요.</p>
    {checking ? <p role="status">재인증 결과를 확인하고 있어요.</p> : <button type="button" disabled={busy} onClick={() => void reauthenticate()}>{busy ? "처리 중…" : grant && remaining > 0 ? "Google로 다시 확인하기" : "Google로 본인 확인"}</button>}
    {grant && <form className="stack-form" onSubmit={remove}>
      <p>{remaining > 0 ? "본인 확인을 마쳤어요. 10분 이내에 삭제를 요청해 주세요." : "본인 확인이 만료됐어요. Google로 다시 확인해 주세요."}</p>
      <label className="checkbox-row"><input type="checkbox" required disabled={busy || remaining <= 0} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>탈퇴를 취소하거나 기록을 복구할 수 없음을 이해했고, 계정 삭제를 요청합니다.</span></label>
      <button className="button" type="submit" disabled={!confirmed || busy || remaining <= 0}>{busy ? "접수 확인 중…" : "계정 삭제 요청"}</button>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p><a href="/">돌아가기</a></p><LogoutButtons />
  </section></main>;
}
