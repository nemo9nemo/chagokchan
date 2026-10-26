"use client";

import { useEffect, useRef, type FormEvent } from "react";
import policy from "../../policies/app-policy.json";
import TagInput, { type TagInputHandle } from "./tag-input";

export default function PraiseSheet(props: {
  title: string; ordinal: number; nickname: string; timestamp: string;
  message: string; date: string; tags: string[]; sending: boolean; retry: boolean; error: string;
  onMessage: (value: string) => void; onDate: (value: string) => void; onTags: (value: string[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, tags: string[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tagInput = useRef<TagInputHandle>(null);
  const sending = useRef(props.sending);
  sending.current = props.sending;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const media = window.matchMedia("(max-width: 760px)");
    const position = () => {
      if (element.open) element.close();
      if (media.matches) element.showModal(); else element.show();
    };
    position();
    media.addEventListener("change", position);
    return () => { media.removeEventListener("change", position); element.close(); };
  }, []);
  const today = new Date();
  const min = new Date(today);
  min.setDate(min.getDate() - policy.time.self_occurred_on_backdate_days_max);
  const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return <dialog ref={dialog} className="praise-sheet" aria-labelledby="praise-sheet-heading" aria-busy={props.sending}
    onCancel={(event) => { event.preventDefault(); if (!sending.current) props.onClose(); }}>
    <div className="sheet-handle" aria-hidden="true" />
    <div className="settings-title"><div><p>{props.title}</p><h2 id="praise-sheet-heading">{props.ordinal}번째 알</h2></div>
      <button className="icon-button" type="button" disabled={props.sending} onClick={props.onClose} aria-label="칭찬 입력 닫기"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
    <form className="stack-form" onSubmit={(event) => { event.preventDefault(); if (props.sending) return; const tags = props.retry ? props.tags : tagInput.current?.commit(); if (tags) props.onSubmit(event, tags); }}>
      <fieldset disabled={props.sending || props.retry}>
        <dl className="automatic-values"><div><dt className="field-label"><span>날짜·시간</span> <span className="badge">자동</span></dt><dd>{props.timestamp}</dd></div><div><dt className="field-label"><span>작성자</span> <span className="badge">자동</span></dt><dd>{props.nickname}</dd></div></dl>
        <details><summary>다른 날로 기록</summary><label htmlFor="praise-date">실천한 날</label><input id="praise-date" type="date" min={dateValue(min)} max={dateValue(today)} value={props.date} onChange={(event) => props.onDate(event.target.value)} /></details>
        <TagInput ref={tagInput} tags={props.tags} onChange={props.onTags} />
        <label htmlFor="praise-message" className="field-label"><span>메모</span> <span className="optional-mark">선택</span></label>
        <textarea id="praise-message" rows={3} maxLength={1000} placeholder="짧게 적어 보세요" value={props.message} onChange={(event) => props.onMessage(event.target.value)} />
      </fieldset>
      {props.error && <div className="form-error" role="alert"><b>저장하지 못했어요</b><p>{props.error}</p></div>}
      <button className="button button-primary button-wide" type="submit" disabled={props.sending}>{props.sending && <svg className="spinner" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-8-8" /></svg>}{props.sending ? "저장 중…" : props.error || props.retry ? "다시 저장" : "저장"}</button>
    </form>
  </dialog>;
}
