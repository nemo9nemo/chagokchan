"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type InviteMeta = { id: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };
type Invite = { id: string; code: string; expires_at: string };

export default function SharePanel(props: {
  title: string; loadInvites: () => Promise<InviteMeta[]>; createInvite: () => Promise<Invite>;
  revokeInvite: (id: string) => Promise<unknown>; describeError: (error: unknown) => string;
  onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const [invites, setInvites] = useState<InviteMeta[]>([]);
  const [secret, setSecret] = useState<Invite | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const items = await props.loadInvites();
    if (alive.current) { setInvites(items); setLoaded(true); }
  }, [props.loadInvites]);
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void refresh().catch((failure) => { if (alive.current) setError(props.describeError(failure)); });
    return () => { alive.current = false; dialog.current?.close(); };
  }, [refresh, props.describeError]);
  const close = () => { alive.current = false; setSecret(null); setVisible(false); props.onClose(); };
  const create = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError(""); setNotice(""); setSecret(null); setVisible(false);
    try {
      const invite = await props.createInvite();
      if (!alive.current) return;
      setSecret(invite);
      setNotice("새 코드를 만들었어요. 닫으면 코드 원문을 다시 볼 수 없어요.");
      try { await refresh(); } catch { if (alive.current) setError("코드를 만들었어요. 사용 중인 코드 목록을 다시 불러와 주세요."); }
    } catch (failure) {
      if (!alive.current) return;
      setError(props.describeError(failure));
      setNotice("생성 결과를 다시 확인해요. 생성 응답이 유실됐다면 코드 원문은 복구할 수 없어요. 목록에서 새 초대 정보를 확인해 주세요.");
      try { await refresh(); } catch { if (alive.current) setNotice("목록도 읽지 못했어요. 다시 불러와 확인해 주세요. 코드 원문은 복구할 수 없어요."); }
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      await props.revokeInvite(id);
      if (!alive.current) return;
      if (secret?.id === id) { setSecret(null); setVisible(false); }
      setNotice("폐기한 코드예요");
      await refresh();
    } catch (failure) { if (alive.current) setError(props.describeError(failure)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const copy = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret.code); if (alive.current) setNotice("코드를 복사했어요."); }
    catch { if (alive.current) setError("복사하지 못했어요. 보기 버튼으로 코드를 확인해 주세요."); }
  };
  return <dialog ref={dialog} className="modal-panel share-panel" aria-labelledby="share-panel-heading" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="settings-title"><div><p>{props.title}</p><h2 id="share-panel-heading">공유 켬</h2></div><button className="icon-button" type="button" onClick={close} aria-label="공유 패널 닫기"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
    <section className="connection-section"><h3>연결 코드</h3><p>이 코드로 연결한 사람만, 아래에서 허용하면 이 판에 칭찬할 수 있어요.</p><p>코드는 사람을 연결해요. 이 판의 권한은 아래에서 따로 허용해야 해요.</p>
      <p>코드는 비밀번호처럼 다뤄 주세요. 아무에게나 보여 주지 마세요.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p role="status" aria-live="polite">{notice}</p>
      <button className="button button-primary" type="button" disabled={busy || !loaded} onClick={() => void create()}>{busy ? "처리 중…" : "새 코드 만들기"}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setError(""); void refresh().catch((failure) => setError(props.describeError(failure))); }}>목록 다시 불러오기</button>
      {secret && <div className="invite-secret"><p className="secret-code">{visible ? secret.code : "●●●●●●"}</p><div className="form-actions"><button className="button button-secondary" type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "숨기기" : "보기"}</button><button className="button button-secondary" type="button" onClick={() => void copy()}>복사</button></div></div>}
      {!loaded && <p role="status">코드 목록을 확인하고 있어요.</p>}
      <p>코드는 만들 때 한 번만 볼 수 있어요.</p>
      <ul className="relationship-list">{invites.map((item) => {
        const active = !item.redeemed_at && !item.revoked_at && Date.parse(item.expires_at) > Date.now();
        return <li key={item.id}><div><b>{item.revoked_at ? "폐기한 코드예요" : item.redeemed_at ? "이미 사용된 코드예요" : active ? "사용 중인 코드" : "만료된 코드예요"}</b><span>만든 때 {new Date(item.created_at).toLocaleString("ko-KR")} · 만료 {new Date(item.expires_at).toLocaleString("ko-KR")}</span></div>{active && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void revoke(item.id)}>폐기</button>}</li>;
      })}</ul>
    </section>
    <section className="connection-section"><h3>이 판에 칭찬할 수 있는 사람</h3>{props.children}</section>
  </dialog>;
}
