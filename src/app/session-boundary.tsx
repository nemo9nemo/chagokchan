"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AUTH_CHANNEL } from "@/client/auth-broadcast";

export default function SessionBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [verified, setVerified] = useState(false);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
    function reload() { setVerified(false); window.location.replace("/"); }
    if (channel) channel.onmessage = event => {
      const data = event.data;
      if (data?.type === "signed-out" || (data?.type === "account" && data.user_id !== userId)) reload();
    };
    async function check() {
      const current = ++generation;
      setVerified(false); setFailed(false);
      try {
        const response = await fetch("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
        if (!active || current !== generation) return;
        if (response.status === 401) { reload(); return; }
        if (!response.ok) throw new Error("Session unavailable");
        const data = await response.json() as { user_id: string; account_state: string };
        if (!active || current !== generation) return;
        if (data.user_id !== userId || data.account_state !== "active") { reload(); return; }
        setVerified(true);
        setOpened(true);
        channel?.postMessage({ type: "account", user_id: userId });
      } catch { if (active && current === generation) setFailed(true); }
    }
    function visibility() {
      if (document.visibilityState === "hidden") { generation++; setVerified(false); }
      else void check();
    }
    function pageShow(event: PageTransitionEvent) { if (event.persisted) reload(); }
    void check();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageShow);
    return () => { active = false; channel?.close(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", pageShow); };
  }, [userId]);
  return <>
    {opened && <div hidden={!verified} inert={!verified}>{children}</div>}
    {!verified && <main className="auth-shell" aria-busy={!failed}><section className="content-card"><h1>계정을 확인하고 있어요</h1>{failed ? <><p role="alert">연결을 확인한 뒤 다시 열어 주세요.</p><button type="button" onClick={() => window.location.reload()}>다시 확인하기</button></> : <p role="status">잠시만 기다려 주세요.</p>}</section></main>}
  </>;
}
