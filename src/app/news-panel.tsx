"use client";

import { useEffect, useRef } from "react";
import { canOpenConnections, notificationLabel } from "./news-labels.mjs";

export type NewsTab = "received" | "sent";
export type NewsNotification = { id: string; type: string; created_at: string; read_at: string | null };
export type SentPraise = { id: string; message: string | null; recorded_at: string; cancelled_at: string | null; can_cancel: boolean };
type RowError = { id: string; message: string } | null;

export default function NewsPanel(props: {
  tab: NewsTab; onTab: (tab: NewsTab) => void; formatDate: (value: string | null) => string | null;
  notifications: NewsNotification[]; notificationCursor: string | null; notificationLoading: boolean; notificationError: string;
  notificationBusyId: string; notificationRowError: RowError; onRead: (item: NewsNotification) => void;
  onConnections: (item: NewsNotification) => void; onRetryNotifications: () => void; onMoreNotifications: () => void;
  sentPraises: SentPraise[]; sentCursor: string | null; sentLoading: boolean; sentError: string; sentRowError: RowError;
  cancelTarget: SentPraise | null; cancelling: boolean; onCancelTarget: (item: SentPraise | null) => void;
  onConfirmCancel: () => void; onRetrySent: () => void; onMoreSent: () => void;
}) {
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const cancelTargetId = props.cancelTarget?.id;
  useEffect(() => {
    if (cancelTargetId) cancelDialog.current?.showModal();
  }, [cancelTargetId]);

  const notificationBusy = props.notificationLoading || Boolean(props.notificationBusyId);
  const sentBusy = props.sentLoading || props.cancelling;
  return <section className="content-card news-center" aria-labelledby="news-heading">
    <h2 id="news-heading">소식</h2>
    <fieldset className="board-tabs news-tabs">
      <legend className="visually-hidden">소식 목록 선택</legend>
      <button type="button" aria-pressed={props.tab === "received"} onClick={() => props.onTab("received")}>받은 소식</button>
      <button type="button" aria-pressed={props.tab === "sent"} onClick={() => props.onTab("sent")}>보낸 칭찬</button>
    </fieldset>
    {props.tab === "received" ? <section aria-label="받은 소식" aria-busy={props.notificationLoading}>
      {props.notificationError && <div className="inline-alert" role="alert"><span>{props.notificationError}</span><button type="button" disabled={notificationBusy} onClick={props.onRetryNotifications}>다시 불러오기</button></div>}
      {props.notificationLoading && <p role="status">불러오고 있어요</p>}
      {!props.notificationLoading && !props.notificationError && props.notifications.length === 0 && <p className="history-empty">아직 소식이 없어요.</p>}
      <ul className="news-list">{props.notifications.map((item) => <li key={item.id}>
        <div className="news-row-copy">
          {item.read_at === null ? <><strong>{notificationLabel(item.type)}</strong><span className="badge">새 소식</span></> : <p>{notificationLabel(item.type)}</p>}
          <time dateTime={item.created_at}>{props.formatDate(item.created_at)}</time>
          {props.notificationRowError?.id === item.id && <p className="form-error" role="alert">{props.notificationRowError.message}</p>}
        </div>
        <div className="entry-actions">
          {item.read_at === null && <button className="button button-secondary" type="button" disabled={notificationBusy} onClick={() => props.onRead(item)}>{props.notificationBusyId === item.id ? "처리 중…" : "읽음으로 표시"}</button>}
          {canOpenConnections(item.type) && <button className="button button-secondary" type="button" disabled={notificationBusy} onClick={() => props.onConnections(item)}>연결 관리로</button>}
        </div>
      </li>)}</ul>
      {props.notificationCursor && <button className="button button-secondary button-wide" type="button" disabled={notificationBusy} onClick={props.onMoreNotifications}>더 보기</button>}
    </section> : <section aria-label="보낸 칭찬" aria-busy={props.sentLoading}>
      {props.sentError && <div className="inline-alert" role="alert"><span>{props.sentError}</span><button type="button" disabled={sentBusy} onClick={props.onRetrySent}>다시 불러오기</button></div>}
      {props.sentLoading && <p role="status">불러오고 있어요</p>}
      {!props.sentLoading && !props.sentError && props.sentPraises.length === 0 && <p className="history-empty">아직 보낸 칭찬이 없어요.</p>}
      <ul className="news-list">{props.sentPraises.map((item) => <li key={item.id}>
        <div className="news-row-copy">
          {item.cancelled_at ? <span className="badge">취소한 칭찬</span> : <p className="entry-message">{item.message || "칭찬 1건"}</p>}
          <time dateTime={item.recorded_at}>{props.formatDate(item.recorded_at)}</time>
          {props.sentRowError?.id === item.id && <p className="form-error" role="alert">{props.sentRowError.message}</p>}
        </div>
        {item.can_cancel && <button className="button button-secondary" type="button" disabled={sentBusy} onClick={() => props.onCancelTarget(item)}>취소</button>}
      </li>)}</ul>
      {props.sentCursor && <button className="button button-secondary button-wide" type="button" disabled={sentBusy} onClick={props.onMoreSent}>더 보기</button>}
    </section>}
    {props.cancelTarget && <dialog ref={cancelDialog} className="modal-panel cancel-sheet" aria-labelledby="cancel-sent-heading" aria-describedby="cancel-sent-description" aria-busy={props.cancelling}
      onCancel={(event) => { event.preventDefault(); if (!props.cancelling) props.onCancelTarget(null); }}>
      <div className="sheet-handle" aria-hidden="true" />
      <h2 id="cancel-sent-heading">이 칭찬을 취소할까요?</h2>
      <p id="cancel-sent-description">취소하면 본문이 지워지고 받은 사람의 개수에서도 빠져요. 되돌릴 수 없어요.</p>
      {props.sentRowError?.id === props.cancelTarget.id && <p className="form-error" role="alert">{props.sentRowError.message}</p>}
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={props.cancelling} onClick={() => props.onCancelTarget(null)}>돌아가기</button>
        <button className="button button-primary" type="button" disabled={sentBusy} onClick={props.onConfirmCancel}>{props.cancelling ? "취소하는 중…" : "확인"}</button>
      </div>
    </dialog>}
  </section>;
}
