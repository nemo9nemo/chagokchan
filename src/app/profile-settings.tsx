"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { avatarKeys, formatDisplayCode, normalizeNickname, profileDisplayCode } from "@/shared/profile.mjs";

type Profile = { user_id: string; nickname: string | null; avatar_key: string | null };
const avatarLabels: Record<string, string> = { grape: "포도", leaf: "잎", star: "별" };

export default function ProfileSettings({ profile, onSave, onClose, describeError }: {
  profile: Profile; onSave: (patch: Record<string, string>) => Promise<void>; onClose: () => void; describeError: (error: unknown) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(false);
  const alive = useRef(true);
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [avatar, setAvatar] = useState(profile.avatar_key ?? "star");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalized = normalizeNickname(nickname);
  const dirty = normalized !== profile.nickname || avatar !== profile.avatar_key;
  useEffect(() => {
    alive.current = true;
    const node = dialog.current;
    const previousFocus = document.activeElement;
    node?.showModal();
    return () => {
      alive.current = false; node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || !dirty) return;
    if (normalized === null) { setError("이름은 공백만 사용하지 않고 1~20자로 입력해 주세요."); return; }
    const patch: Record<string, string> = {};
    if (normalized !== profile.nickname) patch.nickname = normalized;
    if (avatar !== profile.avatar_key) patch.avatar_key = avatar;
    operation.current = true; setBusy(true); setError("");
    try { await onSave(patch); if (alive.current) onClose(); }
    catch (reason) { if (alive.current) setError(describeError(reason)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="profile-dialog content-card" aria-labelledby="profile-heading" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!operation.current) onClose(); }}>
    <h2 id="profile-heading">내 표시 이름 설정</h2>
    <p>지인에게 보일 이름과 아바타예요. Google의 이름이나 이메일은 자동으로 공개하지 않아요.</p>
    <p className="profile-code">내 구분 표시 {formatDisplayCode(profileDisplayCode(profile.user_id))}</p>
    <p className="field-hint">같은 이름을 구분하는 보조 표시예요. 초대는 실제 지인에게 받은 것인지 확인해 주세요.</p>
    <form className="stack-form" onSubmit={event => void submit(event)}>
      <label htmlFor="profile-nickname">표시 이름</label>
      <input id="profile-nickname" autoComplete="nickname" value={nickname} maxLength={80} required disabled={busy}
        aria-describedby="profile-name-hint" onChange={event => setNickname(event.target.value)} />
      <p id="profile-name-hint" className="field-hint">공백만 사용하지 않고 1~20자로 입력해 주세요. 같은 이름도 사용할 수 있어요.</p>
      <label htmlFor="profile-avatar">아바타</label>
      <select id="profile-avatar" value={avatar} disabled={busy} onChange={event => setAvatar(event.target.value)}>
        {avatarKeys.map(key => <option key={key} value={key}>{avatarLabels[key]}</option>)}
      </select>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (!operation.current) onClose(); }}>닫기</button>
        <button type="submit" className="button button-primary" disabled={busy || !dirty || normalized === null}>{busy ? "저장 중…" : "표시 이름 저장"}</button></div>
    </form>
  </dialog>;
}
