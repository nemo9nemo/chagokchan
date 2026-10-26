"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { classifyMutationOutcome, createIdempotentRequest } from "@/client/idempotent-request.mjs";
import { openBoardView } from "@/client/board-loading.mjs";
import GrapeCluster from "./grape-cluster";
import NewsPanel, { type NewsNotification, type NewsTab, type SentPraise } from "./news-panel";
import { canOpenConnections } from "./news-labels.mjs";
import PraiseSheet from "./praise-sheet";
import TagInput, { type TagInputHandle } from "./tag-input";
import SharePanel from "./share-panel";

type GoalStatus = "active" | "completed" | "archived";
type Bunch = { id: string; cycle_no: number; target_count: number; valid_count: number; progress_state: "incomplete" | "complete"; completed_at: string | null };
type GoalSummary = { id: string; title: string; private_description: string | null; status: GoalStatus; revision: number; created_at: string; completed_at: string | null; archived_at: string | null };
type TrashGoal = { id: string; title: string; deleted_at: string; purge_after: string; revision: number };
type Board = { viewer_role: "owner"; id: string; goal_id: string; kind: "personal" | "shared"; revision: number; next_target_count: number; shared_title: string | null; shared_description: string | null; current_bunch: Bunch | null };
type ContributorBoard = { viewer_role: "contributor"; id: string; kind: "shared"; shared_title: string; shared_description: string | null; owner: { user_id: string; nickname: string | null; avatar_key: string | null }; goal_state: GoalStatus; current_bunch: Bunch | null; can_praise: boolean };
type GoalDetail = { goal: GoalSummary; boards: Board[] };
type Praise = { viewer_role: "owner" | "contributor"; id: string; bunch_id: string; source: "self" | "peer"; actor: { user_id: string; nickname: string | null; avatar_key: string | null } | null; actor_label: string; message: string | null; occurred_on: string | null; tags?: string[]; recorded_at: string; cancelled_at: string | null; hidden_at: string | null; excluded_at: string | null; author_erased_at: string | null };
type Page<T> = { items: T[]; next_cursor: string | null };
type IdempotentAttempt = { key: string; body: Record<string, unknown> };
type Profile = { user_id: string; nickname: string | null; avatar_key: string | null };
type Connection = { id: string; status: "active" | "inactive"; generation: number; other_user: Profile | null };
type InviteMeta = { id: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };
type ConnectionRequest = { id: string; direction: "incoming" | "outgoing"; other_user: Profile | null; status: "pending" | "accepted" | "rejected" | "cancelled" | "expired"; created_at: string; expires_at: string };
type Block = { id: string; blocked_user: Profile; created_at: string };
type BoardMember = { user: Profile; role: "contributor"; status: "active" | "revoked"; connection_generation: number };
type ConnectionInvite = { id: string; link_path: string; code: string; expires_at: string };
type WorkspaceView = "goals" | "connections" | "shared" | "trash" | "news";
type NewsPage<T> = Page<T> & { loading: boolean; error: string };

class ApiFailure extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function ConnectionsPanel(props: {
  loading: boolean; error: string; connections: Connection[]; invites: InviteMeta[]; requests: ConnectionRequest[]; blocks: Block[];
  inviteResult: ConnectionInvite | null; invitePreview: { inviter_nickname: string; expires_at: string } | null;
  inviteToken: string; inviteCode: string; previewError: string; previewLoading: boolean; requestAttempt: boolean;
  onCreateInvite: () => void; onRefresh: () => void; onPreview: (secret: { link_token: string } | { code: string }) => void; onInviteCodeChange: (value: string) => void;
  onRequest: (event?: FormEvent<HTMLFormElement>) => void; onClearInvite: () => void;
  onResolveRequest: (item: ConnectionRequest, action: "accept" | "reject" | "cancel") => void;
  onDisconnect: (item: Connection) => void; onBlock: (userId: string) => void; onRevokeBlock: (item: Block) => void; onRevokeInvite: (item: InviteMeta) => void;
}) {
  const activeConnections = props.connections.filter((item) => item.status === "active");
  const incoming = props.requests.filter((item) => item.direction === "incoming" && item.status === "pending");
  const outgoing = props.requests.filter((item) => item.direction === "outgoing" && item.status === "pending");
  const displayName = (person: Profile | null) => person?.nickname ?? "연결 종료 사용자";
  const copyInvite = () => {
    if (!props.inviteResult) return;
    void navigator.clipboard?.writeText(`${window.location.origin}${props.inviteResult.link_path}`);
  };

  return <section className="content-card connection-center" aria-labelledby="connections-heading" aria-busy={props.loading || props.previewLoading}>
    <p className="eyebrow">PEOPLE & PERMISSIONS</p><h2 id="connections-heading">연결 관리</h2>
    <p className="section-intro">연결을 맺은 것만으로 목표가 공유되지는 않아요. 공유판마다 따로 권한을 선택해요.</p>
    {props.error && <div className="inline-alert" role="alert"><span>{props.error}</span><button type="button" onClick={props.onRefresh}>다시 불러오기</button></div>}
    {props.previewError && <p className="form-error" role="alert">{props.previewError}</p>}

    <section className="connection-section" aria-labelledby="invite-heading">
      <div className="settings-title invite-heading-row"><div><p className="eyebrow">ONE-TIME INVITE</p><h3 id="invite-heading">초대 링크 만들기</h3></div><button className="button button-primary" type="button" onClick={props.onCreateInvite}>초대 만들기</button></div>
      <p className="field-hint">링크나 코드로 요청을 보낼 수 있어요. 사용 기한은 초대 응답에 표시돼요.</p>
      {props.inviteResult && <div className="invite-secret" role="status">
        <b>이번 탭에서만 확인할 수 있는 초대예요</b>
        <label htmlFor="invite-link">초대 링크</label><div className="invite-link-row"><input id="invite-link" readOnly value={`${typeof window === "undefined" ? "" : window.location.origin}${props.inviteResult.link_path}`} /><button className="button button-secondary" type="button" onClick={copyInvite}>링크 복사</button></div>
        <p>초대 코드 <strong>{props.inviteResult.code}</strong> · {shortDate(props.inviteResult.expires_at)}까지</p>
        <div className="form-actions"><a className="button button-secondary" href={props.inviteResult.link_path} target="_blank" rel="noreferrer">초대 링크 열기</a><button className="text-button" type="button" onClick={props.onClearInvite}>초대 정보 닫기</button></div>
      </div>}
      <form className="invite-code-form" onSubmit={(event) => { event.preventDefault(); props.onPreview({ code: props.inviteCode.trim().replaceAll("-", "") }); }}>
        <label htmlFor="connection-invite-code">받은 초대 코드</label><div className="invite-link-row"><input id="connection-invite-code" autoComplete="off" maxLength={17} value={props.inviteCode} onChange={(event) => props.onInviteCodeChange(event.target.value)} placeholder="초대 코드 입력" /><button className="button button-secondary" type="submit" disabled={!props.inviteCode.trim() || props.previewLoading}>초대 확인</button></div>
      </form>
      {props.previewLoading && <p className="loading-inline" role="status">초대를 확인하고 있어요.</p>}
      {props.invitePreview && <form className="invite-preview" onSubmit={props.onRequest}>
        <p><b>{props.invitePreview.inviter_nickname}</b> 님의 초대예요.</p><p>만료 {shortDate(props.invitePreview.expires_at)} · 연결 요청을 보내면 상대가 수락할 때 연결돼요.</p>
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={props.onClearInvite}>취소</button><button className="button button-primary" type="submit" disabled={props.requestAttempt}>{props.requestAttempt ? "같은 요청 다시 보내기" : "연결 요청 보내기"}</button></div>
      </form>}
    </section>

    <section className="connection-section" aria-labelledby="requests-heading">
      <div className="settings-title"><div><p className="eyebrow">REQUESTS</p><h3 id="requests-heading">연결 요청</h3></div></div>
      {props.loading && props.requests.length === 0 ? <p className="loading-inline" role="status">요청을 불러오고 있어요.</p> : null}
      {incoming.length + outgoing.length === 0 ? <p className="history-empty">대기 중인 연결 요청이 없어요.</p> : <ul className="relationship-list">
        {incoming.map((item) => <li key={item.id}><div><b>{displayName(item.other_user)}</b><span>보낸 요청 · {shortDate(item.expires_at)}까지</span></div><div className="relationship-actions"><button className="button button-primary" type="button" onClick={() => props.onResolveRequest(item, "accept")}>수락</button><button className="button button-secondary" type="button" onClick={() => props.onResolveRequest(item, "reject")}>거절</button></div></li>)}
        {outgoing.map((item) => <li key={item.id}><div><b>{displayName(item.other_user)}</b><span>내가 보낸 요청 · {shortDate(item.expires_at)}까지</span></div><button className="text-button" type="button" onClick={() => props.onResolveRequest(item, "cancel")}>요청 철회</button></li>)}
      </ul>}
    </section>

    <section className="connection-section" aria-labelledby="connected-heading">
      <div className="settings-title"><div><p className="eyebrow">CONNECTIONS</p><h3 id="connected-heading">연결된 사람</h3></div><span className="history-count">{activeConnections.length}</span></div>
      {props.loading && props.connections.length === 0 ? <p className="loading-inline" role="status">연결을 불러오고 있어요.</p> : null}
      {activeConnections.length === 0 ? <p className="history-empty">아직 연결된 사람이 없어요. 초대 링크를 만들어 시작해 보세요.</p> : <ul className="relationship-list">
        {activeConnections.map((item) => { const person = item.other_user; return <li key={item.id}><div><b>{displayName(person)}</b><span>사람 연결됨 · 공유판 권한은 목표 설정에서 따로 선택</span></div>{person && <div className="relationship-actions"><button className="text-button" type="button" onClick={() => props.onDisconnect(item)}>연결 해제</button><button className="text-button danger-link" type="button" onClick={() => props.onBlock(person.user_id)}>차단</button></div>}</li>; })}
      </ul>}
    </section>

    <section className="connection-section" aria-labelledby="invites-heading">
      <div className="settings-title"><div><p className="eyebrow">INVITES</p><h3 id="invites-heading">내가 만든 초대</h3></div></div>
      {props.invites.length === 0 ? <p className="history-empty">아직 만든 초대가 없어요.</p> : <ul className="relationship-list">
        {props.invites.map((item) => {
          const expired = Date.parse(item.expires_at) <= Date.now();
          const status = item.revoked_at ? "철회됨" : item.redeemed_at ? "사용됨" : expired ? "만료됨" : "사용 가능";
          return <li key={item.id}><div><b>{status}</b><span>만료 {shortDate(item.expires_at)}</span></div>{!item.revoked_at && !item.redeemed_at && !expired && <button className="text-button" type="button" onClick={() => props.onRevokeInvite(item)}>초대 철회</button>}</li>;
        })}
      </ul>}
    </section>

    <section className="connection-section" aria-labelledby="blocks-heading">
      <div className="settings-title"><div><p className="eyebrow">BLOCKED</p><h3 id="blocks-heading">차단한 사람</h3></div></div>
      {props.blocks.length === 0 ? <p className="history-empty">차단한 사람이 없어요.</p> : <ul className="relationship-list">
        {props.blocks.map((item) => <li key={item.id}><div><b>{displayName(item.blocked_user)}</b><span>차단 중</span></div><button className="text-button" type="button" onClick={() => props.onRevokeBlock(item)}>차단 해제</button></li>)}
      </ul>}
    </section>
  </section>;
}

function TrashPanel(props: {
  goals: TrashGoal[]; cursor: string | null; loading: boolean; error: string; restoringId: string;
  onRefresh: () => void; onMore: () => void; onRestore: (goal: TrashGoal) => void;
}) {
  return <section className="content-card connection-center trash-center" aria-labelledby="trash-heading" aria-busy={props.loading}>
    <p className="eyebrow">GOAL TRASH</p><h2 id="trash-heading">휴지통</h2>
    <p className="section-intro">삭제한 목표는 30일 동안 복구할 수 있어요. 기한이 지나면 자동 정리 대상이 됩니다. 복구해도 공유 권한은 돌아오지 않아요.</p>
    {props.error && <div className="inline-alert" role="alert"><span>{props.error}</span><button type="button" onClick={props.onRefresh}>다시 불러오기</button></div>}
    {props.loading && props.goals.length === 0 ? <p className="loading-inline" role="status">휴지통을 불러오고 있어요.</p> : null}
    {!props.loading && props.goals.length === 0 && !props.error ? <div className="empty-records"><h3>휴지통이 비어 있어요</h3><p>삭제한 목표가 여기에 표시됩니다.</p></div> : null}
    {props.goals.length > 0 && <ul className="trash-list">{props.goals.map((goal) => <li key={goal.id}>
      <div className="trash-goal-copy"><b>{goal.title}</b><span>삭제 {shortDate(goal.deleted_at)} · {shortDate(goal.purge_after)}까지 복구 가능</span></div>
      <button className="button button-secondary" type="button" disabled={props.restoringId === goal.id} onClick={() => props.onRestore(goal)}>{props.restoringId === goal.id ? "복구 중…" : "목표 복구"}</button>
    </li>)}</ul>}
    {props.cursor && <button className="button button-secondary button-wide" type="button" onClick={props.onMore}>휴지통 더 보기</button>}
  </section>;
}

function SharedBoardsPanel(props: {
  boards: ContributorBoard[]; cursor: string | null; loading: boolean; error: string; selectedBoard: ContributorBoard | null; bunches: Bunch[];
  bunchCursor: string | null; selectedBunchId: string; praises: Praise[]; praiseCursor: string | null; loadingPraises: boolean;
  message: string; attempt: boolean; sending: boolean; formError: string; onSelect: (board: ContributorBoard) => void; onBack: () => void;
  onRefresh: () => void; onMoreBoards: () => void; onBunch: (id: string) => void; onMoreBunches: () => void; onMessage: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRetryPraises: () => void; onMorePraises: () => void;
}) {
  const currentBunch = props.bunches.find((item) => item.id === props.selectedBunchId) ?? props.selectedBoard?.current_bunch ?? null;
  return <section className="shared-board-center" aria-labelledby="shared-boards-heading" aria-busy={props.loading || props.loadingPraises}>
    <p className="eyebrow">SHARED WITH ME</p><h2 id="shared-boards-heading">지인의 공유판</h2>
    <p className="section-intro">공유판에 보낸 칭찬과 회차 개수를 확인해요. 개인 목표와 개인 기록은 이 화면에 표시되지 않아요.</p>
    {props.error && <div className="inline-alert" role="alert"><span>{props.error}</span><button type="button" onClick={props.onRefresh}>다시 불러오기</button></div>}
    <div className="shared-board-layout">
      <nav className="shared-board-directory" aria-label="참여 중인 공유판">
        <div className="settings-title"><h3>참여 중</h3><button className="text-button" type="button" onClick={props.onRefresh}>새로고침</button></div>
        {props.loading && props.boards.length === 0 ? <p className="loading-inline" role="status">공유판을 불러오고 있어요.</p> : null}
        {props.boards.length === 0 && !props.loading ? <p className="history-empty">현재 참여 중인 공유판이 없어요.</p> : null}
        <ul className="shared-board-list">{props.boards.map((board) => <li key={board.id}><button className={`shared-board-card ${props.selectedBoard?.id === board.id ? "selected" : ""}`} type="button" aria-pressed={props.selectedBoard?.id === board.id} onClick={() => props.onSelect(board)}><b>{board.shared_title}</b><span>{board.owner.nickname ?? "공유판 주인"} 님</span><span>{board.current_bunch ? `${board.current_bunch.valid_count} / ${board.current_bunch.target_count} · ${board.current_bunch.cycle_no}회차` : "첫 회차 전"}</span></button></li>)}</ul>
        {props.cursor && <button className="text-button history-more" type="button" onClick={props.onMoreBoards}>공유판 더 보기</button>}
      </nav>
      <div className="shared-board-detail">
        {!props.selectedBoard ? <div className="empty-records"><h3>함께할 공유판을 골라 주세요</h3><p>지인이 권한을 준 공유판만 목록에 보여요.</p></div> : <>
          <div className="goal-header"><div className="goal-heading-copy"><p className="eyebrow">{props.selectedBoard.owner.nickname ?? "지인"} 님의 공유판</p><div className="title-row"><h3>{props.selectedBoard.shared_title}</h3><span className={`status-pill status-${props.selectedBoard.goal_state}`}>{goalStatusLabel(props.selectedBoard.goal_state)}</span></div>{props.selectedBoard.shared_description && <p className="goal-description">{props.selectedBoard.shared_description}</p>}</div><button className="button button-secondary" type="button" onClick={props.onBack}>목록으로</button></div>
          {props.selectedBoard.current_bunch && <section className="shared-progress" aria-label="공유판 현재 회차"><div className="board-progress-top"><span className="board-label">현재 회차 진행</span><span className="board-count">{props.selectedBoard.current_bunch.valid_count} / {props.selectedBoard.current_bunch.target_count}</span></div><span className="progress-track" role="progressbar" aria-label="공유판 현재 회차 진행" aria-valuemin={0} aria-valuemax={props.selectedBoard.current_bunch.target_count} aria-valuenow={props.selectedBoard.current_bunch.valid_count}><span style={{ width: `${Math.min(100, props.selectedBoard.current_bunch.valid_count / props.selectedBoard.current_bunch.target_count * 100)}%` }} /></span><span className="progress-caption">개인 기록과 개수를 합산하지 않아요.</span></section>}
          {currentBunch && <GrapeCluster target={currentBunch.target_count} filled={currentBunch.valid_count} />}
          {props.selectedBoard.can_praise ? <section className="praise-composer" aria-labelledby="peer-composer-heading"><div className="composer-heading"><div><p className="eyebrow">A WORD FOR YOUR FRIEND</p><h3 id="peer-composer-heading">응원 한마디 보내기</h3></div></div><form onSubmit={props.onSubmit}><fieldset disabled={props.sending || props.attempt}><label className="visually-hidden" htmlFor="peer-praise-message">공유판에 보낼 칭찬</label><textarea id="peer-praise-message" maxLength={1000} rows={3} value={props.message} onChange={(event) => props.onMessage(event.target.value)} placeholder="작은 응원도 큰 힘이 돼요." /></fieldset>{props.formError && <p className="form-error" role="alert">{props.formError}</p>}{props.attempt ? <div className="composer-retry"><p>결과가 불확실해 같은 요청으로 확인해요.</p><button className="button button-primary" type="submit" disabled={props.sending}>{props.sending ? "확인 중…" : "같은 칭찬 다시 확인"}</button><button className="text-button" type="button" onClick={props.onRetryPraises}>기록 새로고침</button></div> : <div className="composer-submit"><p>성공 확인 후 공유판 개수에만 반영돼요.</p><button className="button button-primary" type="submit" disabled={props.sending}>{props.sending ? "보내는 중…" : "칭찬 보내기"}</button></div>}</form></section> : <div className="locked-note"><div><b>{props.selectedBoard.goal_state === "completed" ? "완료된 목표예요" : "보관한 목표예요"}</b><p>이전 기록은 읽을 수 있고 새 칭찬은 보낼 수 없어요.</p></div></div>}
          <div className="record-toolbar"><fieldset className="board-tabs"><legend className="visually-hidden">공유 회차 선택</legend>{props.bunches.map((bunch) => <button key={bunch.id} type="button" className={props.selectedBunchId === bunch.id ? "active" : ""} aria-pressed={props.selectedBunchId === bunch.id} onClick={() => props.onBunch(bunch.id)}>{bunch.cycle_no}회차 · {bunch.valid_count}/{bunch.target_count}</button>)}</fieldset>{currentBunch && <p className="cycle-label">{currentBunch.progress_state === "complete" ? "완성" : "진행 중"}</p>}</div>
          {props.bunchCursor && <button className="text-button history-more" type="button" onClick={props.onMoreBunches}>지난 회차 더 보기</button>}
          <div className="records-heading"><div><p className="eyebrow">PRAISES I SENT</p><h3>내가 보낸 칭찬</h3></div><span className="record-total">{currentBunch ? `${currentBunch.valid_count}개` : "기록 없음"}</span></div>
          {props.loadingPraises && <p className="loading-inline" role="status">보낸 칭찬을 불러오고 있어요.</p>}
          {!props.loadingPraises && props.praises.length === 0 && <div className="empty-records"><h4>이 회차에 보낸 칭찬이 없어요</h4><p>첫 응원을 보내면 이곳에 표시돼요.</p></div>}
          <ol className="praise-list" aria-label="내가 보낸 공유 칭찬">{props.praises.map((praise) => <li className={`praise-entry ${praise.cancelled_at ? "cancelled" : ""}`} key={praise.id}><div className="entry-content"><div className="entry-meta"><span>내가 보낸 칭찬</span><time dateTime={praise.recorded_at}>{shortDate(praise.recorded_at)}</time></div>{praise.cancelled_at ? <p className="cancelled-copy">취소된 칭찬이에요.</p> : <p className="entry-message">{praise.message || "짧은 마음을 남겼어요."}</p>}</div></li>)}</ol>
          {props.praiseCursor && <button className="button button-secondary button-wide" type="button" onClick={props.onMorePraises}>칭찬 더 보기</button>}
        </>}
      </div>
    </div>
  </section>;
}

let csrfToken: string | null = null;
let csrfFetchedAt = 0;
let csrfRefresh: Promise<string> | null = null;
const pendingGoalDetails = new Map<string, Promise<GoalDetail>>();

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new Error(offline
      ? "오프라인이에요. 다시 연결한 뒤 상태를 확인해 주세요. 기록은 성공으로 확인되지 않았어요."
      : "서버 응답을 받지 못했습니다. 연결을 확인해 주세요.");
  }
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | T | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    throw new ApiFailure(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "요청을 처리하지 못했습니다.");
  }
  return payload as T;
}

function getGoalDetail(goalId: string) {
  const pending = pendingGoalDetails.get(goalId);
  if (pending) return pending;
  const request = apiJson<GoalDetail>(`/api/v1/goals/${goalId}`);
  pendingGoalDetails.set(goalId, request);
  void request.then(() => {
    if (pendingGoalDetails.get(goalId) === request) pendingGoalDetails.delete(goalId);
  }, () => {
    if (pendingGoalDetails.get(goalId) === request) pendingGoalDetails.delete(goalId);
  });
  return request;
}

async function getCsrfToken() {
  if (csrfToken && Date.now() - csrfFetchedAt < 7 * 60 * 1000) return csrfToken;
  if (!csrfRefresh) {
    csrfRefresh = apiJson<{ csrf_token: string }>("/api/v1/auth/csrf")
      .then((response) => { csrfToken = response.csrf_token; csrfFetchedAt = Date.now(); return response.csrf_token; })
      .finally(() => { csrfRefresh = null; });
  }
  return csrfRefresh;
}

async function mutate<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: Record<string, unknown>, idempotencyKey?: string) {
  const token = await getCsrfToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-CSRF-Token": token };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return apiJson<T>(path, { method, headers, body: JSON.stringify(body) });
}

async function readNewsPages<T>(path: string, cursor: string | null, pageCount: number) {
  const items: T[] = [];
  let firstItems: T[] = [];
  let pages = 0;
  do {
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const page = await apiJson<Page<T>>(`${path}?${query}`);
    if (pages === 0) firstItems = page.items;
    items.push(...page.items);
    cursor = page.next_cursor;
    pages += 1;
  } while (cursor && pages < pageCount);
  return { items, next_cursor: cursor, firstItems, pages };
}

function newRequestKey() {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown) {
  if (error instanceof ApiFailure) {
    const inviteMessages: Record<string, string> = {
      active_invite_limit: "사용 중인 코드가 많아요. 이전 코드를 폐기한 뒤 만들어 주세요.",
      invite_already_used: "이미 사용된 코드예요", invite_expired: "만료된 코드예요", invite_revoked: "폐기한 코드예요",
    };
    if (inviteMessages[error.code]) return inviteMessages[error.code];
  }
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

async function readShareInvites(): Promise<InviteMeta[]> {
  const items: InviteMeta[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const page = await apiJson<Page<InviteMeta>>(`/api/v1/connection-invites?${query}`);
    items.push(...page.items); cursor = page.next_cursor;
  } while (cursor);
  return items;
}

async function createShareInvite() {
  try { return await mutate<ConnectionInvite>("/api/v1/connection-invites", "POST", {}); }
  catch (error) {
    if (error instanceof ApiFailure && error.code === "STATE_CONFLICT") {
      const items = await readShareInvites();
      if (items.filter((item) => !item.revoked_at && !item.redeemed_at && Date.parse(item.expires_at) > Date.now()).length >= 5) {
        throw new Error("사용 중인 코드가 많아요. 이전 코드를 폐기한 뒤 만들어 주세요.");
      }
    }
    throw error;
  }
}

function revokeShareInvite(id: string) { return mutate(`/api/v1/connection-invites/${id}`, "DELETE", {}); }
function recordTime(value: string) { return new Date(value).toLocaleString("ko-KR"); }

function mutationOutcome(error: unknown) {
  if (!(error instanceof ApiFailure)) return "retry_same_key";
  return classifyMutationOutcome(error.status);
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shortDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date) : null;
}

function goalStatusLabel(status: GoalStatus) {
  return status === "active" ? "진행 중" : status === "completed" ? "완료" : "보관";
}

function boardProgress(board: Board | undefined) {
  if (!board) return null;
  if (!board.current_bunch) return `0 / ${board.next_target_count}`;
  return `${board.current_bunch.valid_count} / ${board.current_bunch.target_count}`;
}

export default function ChagokchanApp() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("goals");
  const [theme, setTheme] = useState<"garden" | "grape">("grape");
  const [nickname, setNickname] = useState<string | null>(null);
  const [profileError, setProfileError] = useState("");
  const [showPraise, setShowPraise] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [praiseTags, setPraiseTags] = useState<string[]>([]);
  const [praiseTimestamp, setPraiseTimestamp] = useState("");
  const [savedPraise, setSavedPraise] = useState<{ id: string; boardId: string; bunchId: string } | null>(null);
  const lastAnimatedId = useRef("");
  const [recordDetail, setRecordDetail] = useState<Praise | null>(null);
  const recordDialog = useRef<HTMLDialogElement>(null);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const [cancelTarget, setCancelTarget] = useState<Praise | null>(null);
  const [cancellingPraise, setCancellingPraise] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [goalDetails, setGoalDetails] = useState<Record<string, GoalDetail>>({});
  const [goalCursor, setGoalCursor] = useState<string | null>(null);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [goalListError, setGoalListError] = useState("");
  const [trashGoals, setTrashGoals] = useState<TrashGoal[]>([]);
  const [trashCursor, setTrashCursor] = useState<string | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState("");
  const [restoringGoalId, setRestoringGoalId] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const selectedGoalIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [bunchesByBoard, setBunchesByBoard] = useState<Record<string, Bunch[]>>({});
  const [bunchCursors, setBunchCursors] = useState<Record<string, string | null>>({});
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [selectedBunchId, setSelectedBunchId] = useState("");
  const [praises, setPraises] = useState<Praise[]>([]);
  const [praiseCursor, setPraiseCursor] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingPraises, setLoadingPraises] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const praiseRequestSeq = useRef(0);
  const goalRequestSeq = useRef(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deleteAttempt, setDeleteAttempt] = useState<{ goalId: string; expected_revision: number } | null>(null);
  const [deletingGoal, setDeletingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ title: "", description: "", personalTarget: 20, sharedEnabled: false, sharedDescription: "" });
  const [goalAttempt, setGoalAttempt] = useState<IdempotentAttempt | null>(null);
  const [goalSending, setGoalSending] = useState(false);
  const [goalFormError, setGoalFormError] = useState("");
  const [nameError, setNameError] = useState(false);
  const [praiseMessage, setPraiseMessage] = useState("");
  const [praiseDate, setPraiseDate] = useState(localToday());
  const [praiseAttempt, setPraiseAttempt] = useState<IdempotentAttempt | null>(null);
  const [praiseSending, setPraiseSending] = useState(false);
  const [praiseFormError, setPraiseFormError] = useState("");
  const [editingPraise, setEditingPraise] = useState<{ id: string; message: string; occurredOn: string; tags: string[] } | null>(null);
  const editTagInput = useRef<TagInputHandle>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPraiseEdit, setSavingPraiseEdit] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionInvites, setConnectionInvites] = useState<InviteMeta[]>([]);
  const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [inviteResult, setInviteResult] = useState<ConnectionInvite | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [invitePreview, setInvitePreview] = useState<{ inviter_nickname: string; expires_at: string } | null>(null);
  const [invitePreviewError, setInvitePreviewError] = useState("");
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(false);
  const [inviteRequestAttempt, setInviteRequestAttempt] = useState<IdempotentAttempt | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [managingBoardId, setManagingBoardId] = useState("");
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [memberError, setMemberError] = useState("");
  const [memberSaving, setMemberSaving] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);
  const [sharedBoards, setSharedBoards] = useState<ContributorBoard[]>([]);
  const sharedBoardsRef = useRef<ContributorBoard[]>([]);
  const [sharedBoardsCursor, setSharedBoardsCursor] = useState<string | null>(null);
  const [sharedBoardsLoading, setSharedBoardsLoading] = useState(false);
  const [sharedBoardError, setSharedBoardError] = useState("");
  const [selectedSharedBoard, setSelectedSharedBoard] = useState<ContributorBoard | null>(null);
  const [sharedBunches, setSharedBunches] = useState<Bunch[]>([]);
  const [sharedBunchCursor, setSharedBunchCursor] = useState<string | null>(null);
  const [selectedSharedBunchId, setSelectedSharedBunchId] = useState("");
  const [peerMessage, setPeerMessage] = useState("");
  const [peerAttempt, setPeerAttempt] = useState<IdempotentAttempt | null>(null);
  const [peerSending, setPeerSending] = useState(false);
  const [peerError, setPeerError] = useState("");
  const [newsTab, setNewsTab] = useState<NewsTab>("received");
  const [notifications, setNotifications] = useState<NewsPage<NewsNotification>>({ items: [], next_cursor: null, loading: true, error: "" });
  const [sentPraises, setSentPraises] = useState<NewsPage<SentPraise>>({ items: [], next_cursor: null, loading: true, error: "" });
  const [hasUnreadNews, setHasUnreadNews] = useState(false);
  const [notificationBusyId, setNotificationBusyId] = useState("");
  const [notificationRowError, setNotificationRowError] = useState<{ id: string; message: string } | null>(null);
  const [sentRowError, setSentRowError] = useState<{ id: string; message: string } | null>(null);
  const [sentCancelTarget, setSentCancelTarget] = useState<SentPraise | null>(null);
  const [cancellingSentPraise, setCancellingSentPraise] = useState(false);
  const notificationSequence = useRef(0);
  const sentSequence = useRef(0);
  const notificationPages = useRef(1);
  const sentPages = useRef(1);
  const notificationRetry = useRef({ cursor: null as string | null, pageCount: 1 });
  const sentRetry = useRef({ cursor: null as string | null, pageCount: 1 });
  const notificationOperation = useRef(false);
  const sentOperation = useRef(false);

  const loadNotifications = useCallback(async (cursor: string | null = null, pageCount = 1) => {
    const sequence = ++notificationSequence.current;
    notificationRetry.current = { cursor, pageCount };
    setNotifications((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const page = await readNewsPages<NewsNotification>("/api/v1/notifications", cursor, pageCount);
      if (sequence !== notificationSequence.current) return;
      if (!cursor) setHasUnreadNews(page.firstItems.some((item) => item.read_at === null));
      notificationPages.current = cursor ? notificationPages.current + page.pages : page.pages;
      setNotifications((previous) => ({ items: cursor ? [...new Map([...previous.items, ...page.items].map((item) => [item.id, item])).values()] : page.items, next_cursor: page.next_cursor, loading: false, error: "" }));
    } catch {
      if (sequence === notificationSequence.current) setNotifications((previous) => ({ ...previous, loading: false, error: "소식을 불러오지 못했어요. 다시 시도해 주세요." }));
    }
  }, []);

  const loadSentPraises = useCallback(async (cursor: string | null = null, pageCount = 1) => {
    const sequence = ++sentSequence.current;
    sentRetry.current = { cursor, pageCount };
    setSentPraises((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const page = await readNewsPages<SentPraise>("/api/v1/sent-praises", cursor, pageCount);
      if (sequence !== sentSequence.current) return;
      sentPages.current = cursor ? sentPages.current + page.pages : page.pages;
      setSentPraises((previous) => ({ items: cursor ? [...new Map([...previous.items, ...page.items].map((item) => [item.id, item])).values()] : page.items, next_cursor: page.next_cursor, loading: false, error: "" }));
    } catch {
      if (sequence === sentSequence.current) setSentPraises((previous) => ({ ...previous, loading: false, error: "보낸 칭찬을 불러오지 못했어요. 다시 시도해 주세요." }));
    }
  }, []);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);
  useEffect(() => {
    if (workspaceView === "news") {
      void loadNotifications();
      void loadSentPraises();
    } else {
      setSentCancelTarget(null);
    }
  }, [workspaceView, loadNotifications, loadSentPraises]);

  async function readNotification(item: NewsNotification, openConnections = false) {
    if (notificationOperation.current || notifications.loading || (openConnections && !canOpenConnections(item.type))) return;
    notificationOperation.current = true;
    setNotificationBusyId(item.id);
    setNotificationRowError(null);
    try {
      if (item.read_at === null) {
        await mutate(`/api/v1/notifications/${item.id}`, "PATCH", { read: true });
        const refresh = loadNotifications(null, notificationPages.current);
        if (!openConnections) await refresh;
      }
    } catch {
      if (!openConnections) setNotificationRowError({ id: item.id, message: "읽음으로 표시하지 못했어요. 다시 누르면 같은 요청으로 확인해요." });
    } finally {
      notificationOperation.current = false;
      setNotificationBusyId("");
      if (openConnections) setWorkspaceView("connections");
    }
  }

  async function cancelSentPraise() {
    const item = sentCancelTarget;
    if (!item?.can_cancel || sentOperation.current || sentPraises.loading) return;
    sentOperation.current = true;
    setCancellingSentPraise(true);
    setSentRowError(null);
    try {
      await mutate(`/api/v1/praises/${item.id}/cancel`, "POST", {});
      setSentCancelTarget(null);
      await loadSentPraises(null, sentPages.current);
    } catch {
      setSentRowError({ id: item.id, message: "취소 결과를 확인하지 못했어요. 다시 누르면 같은 요청으로 확인해요." });
    } finally {
      sentOperation.current = false;
      setCancellingSentPraise(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  const loadProfile = useCallback(async () => {
    setProfileError("");
    try { const me = await apiJson<{ profile: Profile }>("/api/v1/me"); setNickname(me.profile.nickname ?? "나"); }
    catch { setProfileError("작성자 정보를 불러오지 못했어요."); }
  }, []);
  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => { if (recordDetail) recordDialog.current?.showModal(); }, [recordDetail]);
  useEffect(() => { if (cancelTarget) cancelDialog.current?.showModal(); }, [cancelTarget]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const refreshConnectionCenter = useCallback(async () => {
    setConnectionLoading(true);
    setConnectionError("");
    try {
      const [connectionPage, invitePage, incomingPage, outgoingPage, blockPage] = await Promise.all([
        apiJson<Page<Connection>>("/api/v1/connections?limit=50"),
        apiJson<Page<InviteMeta>>("/api/v1/connection-invites?limit=50"),
        apiJson<Page<ConnectionRequest>>("/api/v1/connection-requests?direction=incoming&limit=50"),
        apiJson<Page<ConnectionRequest>>("/api/v1/connection-requests?direction=outgoing&limit=50"),
        apiJson<Page<Block>>("/api/v1/blocks?limit=50"),
      ]);
      setConnections(connectionPage.items);
      setConnectionInvites(invitePage.items);
      setConnectionRequests([...incomingPage.items, ...outgoingPage.items]);
      setBlocks(blockPage.items);
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  const loadSharedBoards = useCallback(async (cursor: string | null = null, append = false) => {
    setSharedBoardsLoading(true);
    setSharedBoardError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const page = await apiJson<Page<ContributorBoard>>(`/api/v1/shared-boards?${query.toString()}`);
      const visibleBoards = append ? [...sharedBoardsRef.current, ...page.items] : page.items;
      sharedBoardsRef.current = visibleBoards;
      setSharedBoards(visibleBoards);
      setSharedBoardsCursor(page.next_cursor);
      if (selectedSharedBoard && !visibleBoards.some((board) => board.id === selectedSharedBoard.id)) {
        setSelectedSharedBoard(null);
        setPraises([]);
      }
    } catch (error) {
      setSharedBoardError(errorMessage(error));
    } finally {
      setSharedBoardsLoading(false);
    }
  }, [selectedSharedBoard]);

  const loadTrashGoals = useCallback(async (cursor: string | null = null, append = false) => {
    setTrashLoading(true);
    setTrashError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const page = await apiJson<Page<TrashGoal>>(`/api/v1/trash/goals?${query.toString()}`);
      setTrashGoals((previous) => append ? [...previous, ...page.items] : page.items);
      setTrashCursor(page.next_cursor);
      return page;
    } catch (error) {
      setTrashError(errorMessage(error));
      return null;
    } finally {
      setTrashLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceView === "connections") void refreshConnectionCenter();
    if (workspaceView === "shared") void loadSharedBoards();
    if (workspaceView === "trash") void loadTrashGoals();
  }, [workspaceView, refreshConnectionCenter, loadSharedBoards, loadTrashGoals]);

  useEffect(() => {
    const inviteHash = new URLSearchParams(window.location.hash.slice(1));
    const token = inviteHash.get("invite");
    if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setWorkspaceView("connections");
    setInviteToken(token);
    setInvitePreviewLoading(true);
    void mutate<{ inviter_nickname: string; expires_at: string }>("/api/v1/connection-invites/preview", "POST", { link_token: token })
      .then(setInvitePreview)
      .catch((error) => setInvitePreviewError(errorMessage(error)))
      .finally(() => setInvitePreviewLoading(false));
  }, []);

  const loadGoals = useCallback(async (cursor: string | null = null, append = false) => {
    setLoadingGoals(true);
    setGoalListError("");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const page = await apiJson<Page<GoalDetail>>(`/api/v1/goal-overviews?${query.toString()}`);
      const summaries = page.items.map((item) => item.goal);
      setGoals((previous) => append ? [...previous, ...summaries] : summaries);
      setGoalCursor(page.next_cursor);
      setGoalDetails((previous) => ({ ...previous, ...Object.fromEntries(page.items.map((item) => [item.goal.id, item])) }));
      if (!append && page.items.length === 0) {
        selectedGoalIdRef.current = null;
        setSelectedGoalId(null);
        setDetail(null);
      }
      return page;
    } catch (error) {
      setGoalListError(errorMessage(error));
      return null;
    } finally {
      setLoadingGoals(false);
    }
  }, []);

  const loadPraises = useCallback(async (boardId: string, bunchId: string, cursor: string | null = null, append = false) => {
    const requestSeq = ++praiseRequestSeq.current;
    if (!boardId || !bunchId) {
      setPraises([]);
      setPraiseCursor(null);
      setLoadingPraises(false);
      return;
    }
    setLoadingPraises(true);
    setDetailError("");
    try {
      const query = new URLSearchParams({ limit: "50", bunch_id: bunchId });
      if (cursor) query.set("cursor", cursor);
      const page = await apiJson<Page<Praise>>(`/api/v1/boards/${boardId}/praises?${query.toString()}`);
      if (requestSeq !== praiseRequestSeq.current) return;
      setPraises((previous) => append ? [...previous, ...page.items] : page.items);
      setPraiseCursor(page.next_cursor);
      return page;
    } catch (error) {
      if (requestSeq !== praiseRequestSeq.current) return;
      setDetailError(errorMessage(error));
      if (!append) setPraises([]);
    } finally {
      if (requestSeq === praiseRequestSeq.current) setLoadingPraises(false);
    }
  }, []);

  const openGoal = useCallback(async (goalId: string, preferredBoardId?: string, preferredBunchId?: string) => {
    const requestSeq = ++goalRequestSeq.current;
    praiseRequestSeq.current += 1;
    setPraises([]);
    setPraiseCursor(null);
    setLoadingPraises(true);
    selectedGoalIdRef.current = goalId;
    setSelectedGoalId(goalId);
    setLoadingDetail(true);
    setDetailError("");
    setNotice("");
    setShowCreate(false);
    setShowSettings(false);
    try {
      return await openBoardView({
        goalId, preferredBoardId, preferredBunchId,
        getDetail: getGoalDetail,
        getHistory: (boardId: string, cursor: string | null = null) => {
          const query = new URLSearchParams({ limit: "50" });
          if (cursor) query.set("cursor", cursor);
          return apiJson<Page<Bunch>>(`/api/v1/boards/${boardId}/bunches?${query}`);
        },
        getPraises: loadPraises,
        isCurrent: () => requestSeq === goalRequestSeq.current,
        onReady: (nextDetail: GoalDetail, nextBoard: Board, nextBunch: Bunch | null) => {
          setDetail(nextDetail);
          setGoalDetails((previous) => ({ ...previous, [goalId]: nextDetail }));
          setBunchesByBoard((previous) => ({ ...previous, ...Object.fromEntries(nextDetail.boards.map(board => [board.id, board.current_bunch ? [board.current_bunch] : []])) }));
          setBunchCursors((previous) => ({ ...previous, ...Object.fromEntries(nextDetail.boards.map(board => [board.id, null])) }));
          setSelectedBoardId(nextBoard.id);
          setSelectedBunchId(nextBunch?.id ?? "");
          setEditingPraise(null);
          setLoadingDetail(false);
        },
        onHistory: (boardId: string, page: Page<Bunch>) => {
          setBunchesByBoard(previous => ({ ...previous, [boardId]: page.items }));
          setBunchCursors(previous => ({ ...previous, [boardId]: page.next_cursor }));
        },
        onHistoryError: (error: unknown) => setDetailError(`지난 회차를 불러오지 못했어요. ${errorMessage(error)}`),
      });
    } catch (error) {
      if (requestSeq !== goalRequestSeq.current) return;
      setDetail(null);
      setDetailError(errorMessage(error));
      setLoadingPraises(false);
    } finally {
      if (requestSeq === goalRequestSeq.current) setLoadingDetail(false);
    }
  }, [loadPraises]);

  useEffect(() => { void loadGoals(); }, [loadGoals]);

  const selectedGoal = useMemo(() => goals.find((goal) => goal.id === selectedGoalId) ?? detail?.goal ?? null, [goals, selectedGoalId, detail]);
  const selectedBoard = detail?.boards.find((board) => board.id === selectedBoardId);
  const selectedBunches = bunchesByBoard[selectedBoardId] ?? [];
  const selectedBunch = selectedBunches.find((bunch) => bunch.id === selectedBunchId) ?? selectedBoard?.current_bunch ?? null;

  async function loadMoreGoals() {
    if (goalCursor) await loadGoals(goalCursor, true);
  }

  async function loadMoreBunches(boardId: string) {
    const cursor = bunchCursors[boardId];
    if (!cursor) return;
    try {
      const query = new URLSearchParams({ limit: "50", cursor });
      const page = await apiJson<Page<Bunch>>(`/api/v1/boards/${boardId}/bunches?${query.toString()}`);
      setBunchesByBoard((previous) => ({ ...previous, [boardId]: [...(previous[boardId] ?? []), ...page.items] }));
      setBunchCursors((previous) => ({ ...previous, [boardId]: page.next_cursor }));
    } catch (error) {
      setDetailError(errorMessage(error));
    }
  }

  async function previewInvite(secret: { link_token: string } | { code: string }) {
    setInvitePreview(null);
    setInvitePreviewError("");
    setInviteRequestAttempt(null);
    setInvitePreviewLoading(true);
    try {
      if ("link_token" in secret) { setInviteToken(secret.link_token); setInviteCode(""); }
      else setInviteToken("");
      const preview = await mutate<{ inviter_nickname: string; expires_at: string }>("/api/v1/connection-invites/preview", "POST", secret);
      setInvitePreview(preview);
      setConnectionError("");
    } catch (error) {
      setInvitePreviewError(errorMessage(error));
    } finally {
      setInvitePreviewLoading(false);
    }
  }

  async function createInvite() {
    setConnectionError("");
    setInviteResult(null);
    try {
      const result = await mutate<ConnectionInvite>("/api/v1/connection-invites", "POST", {});
      setInviteResult(result);
      setNotice("일회 초대를 만들었어요. 이 링크와 코드는 한 번만 표시돼요.");
      await refreshConnectionCenter();
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  }

  async function requestConnection(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const secret = inviteToken ? { link_token: inviteToken } : { code: inviteCode.trim().replaceAll("-", "") };
    if (!("link_token" in secret) && !secret.code) return;
    const payload = inviteRequestAttempt?.body ?? secret;
    const attempt = createIdempotentRequest(payload, inviteRequestAttempt, newRequestKey);
    setInviteRequestAttempt(attempt);
    setInvitePreviewError("");
    try {
      await mutate("/api/v1/connection-requests", "POST", attempt.body, attempt.key);
      setInviteRequestAttempt(null);
      setInviteToken("");
      setInviteCode("");
      setInvitePreview(null);
      setInvitePreviewError("");
      setNotice("연결 요청을 보냈어요. 상대가 수락하면 연결돼요.");
      await refreshConnectionCenter();
    } catch (error) {
      if (mutationOutcome(error) === "retry_same_key") {
        setInvitePreviewError(`${errorMessage(error)} 같은 요청 키와 내용을 유지했어요.`);
      } else {
        setInviteRequestAttempt(null);
        setInvitePreviewError(errorMessage(error));
      }
    }
  }

  function clearInviteSecret() {
    setInviteToken("");
    setInviteCode("");
    setInvitePreview(null);
    setInvitePreviewError("");
    setInviteRequestAttempt(null);
    setInviteResult(null);
  }

  async function resolveConnectionRequest(request: ConnectionRequest, action: "accept" | "reject" | "cancel") {
    try {
      await mutate(`/api/v1/connection-requests/${request.id}/${action}`, "POST", {});
      setNotice(action === "accept" ? "연결 요청을 수락했어요. 공유판 권한은 별도로 부여해야 해요." : action === "reject" ? "연결 요청을 거절했어요." : "보낸 연결 요청을 철회했어요.");
      await refreshConnectionCenter();
    } catch (error) { setConnectionError(errorMessage(error)); }
  }

  async function disconnectConnection(connection: Connection) {
    if (!window.confirm("연결을 해제할까요? 이 사람과 연결된 공유판 권한도 함께 끝나요.")) return;
    try {
      await mutate(`/api/v1/connections/${connection.id}`, "DELETE", {});
      setNotice("연결을 해제했어요. 다시 연결해도 예전 공유판 권한은 돌아오지 않아요.");
      await refreshConnectionCenter();
      if (managingBoardId) await loadBoardMembers(managingBoardId);
    } catch (error) { setConnectionError(errorMessage(error)); }
  }

  async function blockUser(userId: string) {
    if (!window.confirm("이 사람을 차단할까요? 연결과 현재 공유판 접근도 종료돼요.")) return;
    try {
      await mutate("/api/v1/blocks", "POST", { user_id: userId });
      setNotice("사용자를 차단했어요.");
      await refreshConnectionCenter();
      if (managingBoardId) await loadBoardMembers(managingBoardId);
    } catch (error) { setConnectionError(errorMessage(error)); }
  }

  async function revokeBlock(block: Block) {
    try {
      await mutate(`/api/v1/blocks/${block.id}`, "DELETE", {});
      setNotice("차단을 해제했어요. 연결·공유판 권한은 자동 복구되지 않아요.");
      await refreshConnectionCenter();
    } catch (error) { setConnectionError(errorMessage(error)); }
  }

  async function revokeInvite(invite: InviteMeta) {
    try {
      await mutate(`/api/v1/connection-invites/${invite.id}`, "DELETE", {});
      setNotice("아직 사용되지 않은 초대를 철회했어요.");
      await refreshConnectionCenter();
    } catch (error) { setConnectionError(errorMessage(error)); }
  }

  async function loadBoardMembers(boardId: string) {
    setManagingBoardId(boardId);
    setMemberError("");
    setMemberLoading(true);
    setBoardMembers([]);
    try {
      const page = await apiJson<Page<BoardMember>>(`/api/v1/boards/${boardId}/members?limit=50`);
      const people: Connection[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "50" });
        if (cursor) query.set("cursor", cursor);
        const connectionPage = await apiJson<Page<Connection>>(`/api/v1/connections?${query}`);
        people.push(...connectionPage.items); cursor = connectionPage.next_cursor;
      } while (cursor);
      setBoardMembers(page.items); setConnections(people);
    } catch (error) { setMemberError(errorMessage(error)); setBoardMembers([]); }
    finally { setMemberLoading(false); }
  }

  async function changeBoardMember(boardId: string, userId: string, granted: boolean) {
    const mutationId = `${boardId}:${userId}`;
    setMemberSaving(mutationId);
    setMemberError("");
    try {
      await mutate(`/api/v1/boards/${boardId}/members/${userId}`, granted ? "DELETE" : "PUT", granted ? {} : { role: "contributor" });
      setNotice(granted ? "이 공유판의 권한을 회수했어요." : "이 공유판을 함께 볼 수 있도록 권한을 줬어요.");
      await Promise.all([loadBoardMembers(boardId), refreshConnectionCenter()]);
    } catch (error) { setMemberError(errorMessage(error)); }
    finally { setMemberSaving(""); }
  }

  async function openSharedBoard(boardId: string, preferredBunchId?: string) {
    setSharedBoardError("");
    setPeerError("");
    try {
      const board = await apiJson<ContributorBoard>(`/api/v1/boards/${boardId}`);
      if (board.viewer_role !== "contributor") throw new Error("현재 공유 권한을 확인할 수 없어요.");
      const query = new URLSearchParams({ limit: "50" });
      const bunchPage = await apiJson<Page<Bunch>>(`/api/v1/boards/${boardId}/bunches?${query.toString()}`);
      const bunchId = (preferredBunchId && bunchPage.items.some((bunch) => bunch.id === preferredBunchId) ? preferredBunchId : null)
        ?? board.current_bunch?.id ?? bunchPage.items[0]?.id ?? "";
      setSelectedSharedBoard(board);
      setSharedBunches(bunchPage.items);
      setSharedBunchCursor(bunchPage.next_cursor);
      setSelectedSharedBunchId(bunchId);
      setSelectedBoardId(board.id);
      setSelectedBunchId(bunchId);
      await loadPraises(board.id, bunchId);
    } catch (error) {
      setSelectedSharedBoard(null);
      setSharedBoardError(errorMessage(error));
      void loadSharedBoards();
    }
  }

  async function submitPeerPraise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSharedBoard?.can_praise) return;
    setPeerError("");
    const payload = peerAttempt?.body ?? { message: peerMessage.trim() || null };
    const attempt = createIdempotentRequest(payload, peerAttempt, newRequestKey);
    setPeerAttempt(attempt);
    setPeerSending(true);
    try {
      const result = await mutate<{ id: string; bunch_id: string; replayed: boolean }>(`/api/v1/boards/${selectedSharedBoard.id}/praises`, "POST", attempt.body, attempt.key);
      setPeerAttempt(null);
      setPeerMessage("");
      setNotice(result.replayed ? "이전에 보낸 칭찬이 기록된 것을 확인했어요." : "공유판에 칭찬을 보냈어요.");
      await loadSharedBoards();
      await openSharedBoard(selectedSharedBoard.id, result.bunch_id);
    } catch (error) {
      if (mutationOutcome(error) === "retry_same_key") setPeerError(`${errorMessage(error)} 같은 요청 키와 내용을 유지했어요.`);
      else { setPeerAttempt(null); setPeerError(errorMessage(error)); }
    } finally { setPeerSending(false); }
  }

  async function loadMoreSharedBunches() {
    if (!selectedSharedBoard || !sharedBunchCursor) return;
    try {
      const query = new URLSearchParams({ limit: "50", cursor: sharedBunchCursor });
      const page = await apiJson<Page<Bunch>>(`/api/v1/boards/${selectedSharedBoard.id}/bunches?${query.toString()}`);
      setSharedBunches((previous) => [...previous, ...page.items]);
      setSharedBunchCursor(page.next_cursor);
    } catch (error) { setSharedBoardError(errorMessage(error)); }
  }

  async function loadMoreSharedBoards() {
    if (sharedBoardsCursor) await loadSharedBoards(sharedBoardsCursor, true);
  }

  async function moderatePeerPraise(praise: Praise, action: "hide" | "unhide" | "exclude") {
    const confirmation = action === "exclude" ? "이 칭찬을 회차 집계에서 제외할까요? 개수와 완성 상태가 다시 계산돼요." : null;
    if (confirmation && !window.confirm(confirmation)) return;
    try {
      await mutate(`/api/v1/praises/${praise.id}/${action}`, "POST", {});
      setNotice(action === "hide" ? "받은 칭찬을 나에게만 숨겼어요." : action === "unhide" ? "숨긴 칭찬을 다시 표시했어요." : "회차 집계에서 칭찬을 제외했어요.");
      await refreshCurrentGoal();
    } catch (error) { setDetailError(errorMessage(error)); }
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (goalSending) return;
    if (!goalAttempt && (!goalDraft.title.trim() || [...goalDraft.title].length > 80)) {
      setNameError(true); document.getElementById("goal-title")?.focus(); return;
    }
    setNameError(false);
    setGoalFormError("");
    const payload: Record<string, unknown> = goalAttempt?.body ?? {
      title: goalDraft.title,
      private_description: goalDraft.description || null,
      personal_target_count: Number(goalDraft.personalTarget),
      ...(goalDraft.sharedEnabled ? { shared_board: {
        title: goalDraft.title,
        description: goalDraft.sharedDescription || null,
        target_count: Number(goalDraft.personalTarget),
      } } : {}),
    };
    const attempt = createIdempotentRequest(payload, goalAttempt, newRequestKey);
    setGoalAttempt(attempt);
    setGoalSending(true);
    try {
      const result = await mutate<{ id: string; replayed: boolean }>("/api/v1/goals", "POST", attempt.body, attempt.key);
      setGoalAttempt(null);
      selectedGoalIdRef.current = result.id;
      setSelectedGoalId(result.id);
      setGoalDraft({ title: "", description: "", personalTarget: 20, sharedEnabled: false, sharedDescription: "" });
      setNotice(result.replayed ? "같은 요청으로 만든 목표를 확인했어요." : "새 목표를 만들었어요.");
      await loadGoals();
      await openGoal(result.id);
    } catch (error) {
      const outcome = mutationOutcome(error);
      if (outcome === "retry_same_key") {
        setGoalFormError(`${errorMessage(error)} 응답이 불확실해요. 같은 요청 키와 내용을 유지했습니다.`);
      } else {
        setGoalAttempt(null);
        setGoalFormError(errorMessage(error));
      }
    } finally {
      setGoalSending(false);
    }
  }

  async function submitPraise(event: FormEvent<HTMLFormElement>, tags: string[]) {
    event.preventDefault();
    if (praiseSending || selectedBoard?.kind !== "personal" || selectedGoal?.status !== "active") return;
    setPraiseFormError("");
    const payload: Record<string, unknown> = praiseAttempt?.body ?? {
      message: praiseMessage.trim() || null,
      occurred_on: praiseDate || null,
      tags,
    };
    const attempt = createIdempotentRequest(payload, praiseAttempt, newRequestKey);
    setPraiseAttempt(attempt);
    setPraiseSending(true);
    try {
      const result = await mutate<{ id: string; bunch_id: string; replayed: boolean }>(`/api/v1/boards/${selectedBoard.id}/praises`, "POST", attempt.body, attempt.key);
      setPraiseAttempt(null);
      setPraiseMessage("");
      setPraiseDate(localToday());
      setPraiseTags([]); setShowPraise(false);
      await loadGoals();
      const refreshed = await openGoal(selectedGoal.id, selectedBoard.id, result.bunch_id);
      if (refreshed?.bunch?.progress_state === "complete") {
        setSavedPraise(null); setNotice("회차가 완성됐어요. 다음 회차에도 칭찬을 쌓아 보세요.");
      } else if (refreshed?.page?.items[0]?.id === result.id && !refreshed.page.items[0].cancelled_at && !refreshed.page.items[0].excluded_at) {
        if (lastAnimatedId.current !== result.id) {
          lastAnimatedId.current = result.id;
          setSavedPraise({ id: result.id, boardId: selectedBoard.id, bunchId: result.bunch_id });
        }
        setNotice(result.replayed ? "이전에 저장한 칭찬을 확인했어요." : "칭찬을 저장했어요.");
      } else setNotice(refreshed?.page ? "저장한 칭찬과 최신 회차를 확인했어요." : "저장은 확인됐어요. 최신 기록을 다시 불러와 주세요.");
    } catch (error) {
      const outcome = mutationOutcome(error);
      if (outcome === "retry_same_key") {
        setPraiseFormError("연결이 끊겼어요. 입력한 내용은 그대로 있어요. 같은 요청으로 다시 저장해요.");
      } else {
        setPraiseAttempt(null);
        setPraiseFormError(errorMessage(error));
      }
    } finally {
      setPraiseSending(false);
    }
  }

  async function refreshCurrentGoal() {
    if (selectedGoalId) await openGoal(selectedGoalId, selectedBoardId, selectedBunchId);
  }

  async function saveGoalSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    setSavingSettings(true);
    setDetailError("");
    try {
      await mutate(`/api/v1/goals/${detail.goal.id}`, "PATCH", {
        expected_revision: detail.goal.revision,
        title: String(form.get("title") ?? ""),
        private_description: String(form.get("description") ?? "") || null,
      });
      setNotice("목표 정보를 저장했어요.");
      setShowSettings(false);
      await loadGoals();
      await openGoal(detail.goal.id, selectedBoardId, selectedBunchId);
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveBoardSettings(event: FormEvent<HTMLFormElement>, board: Board) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patch: Record<string, unknown> = { expected_revision: board.revision, next_target_count: Number(form.get("target")) };
    if (board.kind === "shared") {
      patch.shared_title = String(form.get("sharedTitle") ?? "");
      patch.shared_description = String(form.get("sharedDescription") ?? "") || null;
    }
    setSavingSettings(true);
    setDetailError("");
    try {
      await mutate(`/api/v1/boards/${board.id}`, "PATCH", patch);
      setNotice(board.kind === "personal" ? "개인판의 다음 회차 목표를 저장했어요." : "공유판 설정을 저장했어요.");
      await loadGoals();
      await openGoal(board.goal_id, selectedBoardId, selectedBunchId);
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  }

  async function transitionGoal(action: "complete" | "archive" | "resume") {
    if (!detail) return;
    const messages = { complete: "목표를 완료로 바꿀까요? 진행 중인 기록은 남고 새 칭찬은 잠깁니다.", archive: "목표를 보관할까요? 기록은 그대로 남습니다.", resume: "목표를 다시 진행할까요? 이어서 같은 회차를 사용합니다." };
    if (!window.confirm(messages[action])) return;
    try {
      await mutate(`/api/v1/goals/${detail.goal.id}/${action}`, "POST", { expected_revision: detail.goal.revision });
      setNotice(action === "complete" ? "목표를 완료했어요." : action === "archive" ? "목표를 보관했어요." : "목표를 다시 시작했어요.");
      await loadGoals();
      await openGoal(detail.goal.id, selectedBoardId, selectedBunchId);
    } catch (error) {
      setDetailError(errorMessage(error));
    }
  }

  async function deleteGoal(retry = false) {
    if (!detail || deletingGoal) return;
    const attempt = deleteAttempt?.goalId === detail.goal.id ? deleteAttempt : { goalId: detail.goal.id, expected_revision: detail.goal.revision };
    if (!retry && !window.confirm("이 목표를 휴지통으로 옮길까요? 30일 안에 복구할 수 있어요. 공유판 권한은 즉시 회수되며 복구해도 돌아오지 않습니다.")) return;
    setDeletingGoal(true);
    setDetailError("");
    try {
      await mutate(`/api/v1/goals/${attempt.goalId}`, "DELETE", { expected_revision: attempt.expected_revision });
      setDeleteAttempt(null);
      selectedGoalIdRef.current = null;
      setSelectedGoalId(null);
      setDetail(null);
      setShowSettings(false);
      setWorkspaceView("trash");
      setNotice("목표를 휴지통으로 옮겼어요. 공유판 권한은 회수되어 복구되지 않습니다.");
      await Promise.all([loadGoals(), loadTrashGoals()]);
    } catch (error) {
      setDeleteAttempt(error instanceof ApiFailure && error.status < 500 ? null : attempt);
      setDetailError(errorMessage(error));
    } finally {
      setDeletingGoal(false);
    }
  }

  async function restoreGoal(goal: TrashGoal) {
    if (restoringGoalId) return;
    setRestoringGoalId(goal.id);
    setTrashError("");
    try {
      await mutate(`/api/v1/goals/${goal.id}/restore`, "POST", { expected_revision: goal.revision });
      setNotice("목표를 보관함으로 복구했어요. 공유 권한은 새로 선택해야 합니다.");
      await Promise.all([loadTrashGoals(), loadGoals()]);
    } catch (error) {
      const latest = await loadTrashGoals();
      if (latest?.items.some((item) => item.id === goal.id)) {
        setTrashError(`${errorMessage(error)} 휴지통 목록을 새로 확인했어요. 변경된 revision으로 다시 시도할 수 있습니다.`);
      } else if (latest) {
        setTrashError("목표가 휴지통에서 사라졌어요. 목표 목록을 새로고침해 상태를 확인해 주세요.");
        await loadGoals();
      }
    } finally {
      setRestoringGoalId("");
    }
  }

  async function savePraiseEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPraise || savingPraiseEdit) return;
    const tags = editTagInput.current?.commit();
    if (!tags) return;
    const form = new FormData(event.currentTarget);
    setSavingPraiseEdit(true);
    try {
      await mutate(`/api/v1/praises/${editingPraise.id}`, "PATCH", {
        message: String(form.get("message") ?? "") || null,
        occurred_on: String(form.get("occurredOn") ?? "") || null,
        tags,
      });
      setEditingPraise(null);
      setNotice("기록을 수정했어요.");
      setRecordDetail(null);
      await loadPraises(selectedBoardId, selectedBunchId);
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setSavingPraiseEdit(false);
    }
  }

  async function cancelPraise(praise: Praise) {
    if (cancellingPraise) return;
    setCancellingPraise(true);
    try {
      await mutate(`/api/v1/praises/${praise.id}/cancel`, "POST", {});
      setCancelTarget(null); setRecordDetail(null);
      setNotice("기록을 취소했어요. 해당 메모와 실천일·태그는 삭제됐습니다.");
      await loadGoals();
      await refreshCurrentGoal();
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally { setCancellingPraise(false); }
  }

  function chooseBoard(board: Board) {
    setShowPraise(false); setSavedPraise(null);
    setSelectedBoardId(board.id);
    const nextBunchId = board.current_bunch?.id ?? bunchesByBoard[board.id]?.[0]?.id ?? "";
    setSelectedBunchId(nextBunchId);
    setEditingPraise(null);
    void loadPraises(board.id, nextBunchId);
  }

  function chooseBunch(bunchId: string) {
    setShowPraise(false); setSavedPraise(null);
    setSelectedBunchId(bunchId);
    setEditingPraise(null);
    void loadPraises(selectedBoardId, bunchId);
  }

  function returnToBoards() {
    goalRequestSeq.current += 1; praiseRequestSeq.current += 1;
    selectedGoalIdRef.current = null;
    setSelectedGoalId(null); setDetail(null); setLoadingDetail(false);
    setShowCreate(false); setShowPraise(false); setShowShare(false); setDetailError("");
    setWorkspaceView("goals");
  }

  function openPraiseComposer() {
    if (!praiseAttempt) setPraiseTimestamp(recordTime(new Date().toISOString()));
    setSavedPraise(null); setShowPraise(true);
  }

  const interactionLocked = loadingDetail || praiseSending || Boolean(praiseAttempt);
  const sharedBoard = detail?.boards.find((board) => board.kind === "shared");
  const canAddPraise = !loadingDetail && detail?.goal.id === selectedGoalId && selectedBoard?.kind === "personal" && selectedGoal?.status === "active" &&
    (!selectedBunch || selectedBunch.id === selectedBoard.current_bunch?.id);
  const savedInView = savedPraise?.boardId === selectedBoardId && savedPraise.bunchId === selectedBunchId && praises[0]?.id === savedPraise.id;
  const recordOrdinal = (praise: Praise) => Math.max(1, (selectedBunch?.valid_count ?? 0) - praises.slice(0, praises.findIndex((item) => item.id === praise.id)).filter((item) => !item.cancelled_at && !item.excluded_at).length);

  return (
    <main id="app-shell" className="app-shell">
      <a className="skip-link" href="#workspace-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <button className="back-link" type="button" disabled={interactionLocked} onClick={returnToBoards}>판 고르기</button>
        <a className="brand-lockup" href="/" aria-label="차곡찬 홈" onClick={(event) => { event.preventDefault(); if (!interactionLocked) returnToBoards(); }}><span className="brand-name">차곡찬</span></a>
        {workspaceView === "goals" && detail && !showCreate && (sharedBoard
          ? <button className="badge share-badge" type="button" disabled={interactionLocked} onClick={() => { setShowShare(true); void loadBoardMembers(sharedBoard.id); }}>공유 켬</button>
          : <span className="badge" title="공유판은 판을 만들 때 켤 수 있어요">공유 끔</span>)}
        <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "garden" ? "grape" : "garden")} aria-label="화면 색상 테마" aria-pressed={theme === "grape"}>테마 · {theme === "garden" ? "정원" : "포도"}</button>
      </header>
      {isOnline === false && <div className="offline-banner" role="status" aria-live="polite">오프라인이에요. 다시 연결한 뒤 기록을 확인해 주세요. 오프라인 전송은 저장되거나 성공 처리되지 않아요.</div>}
      <div className="workspace">
        <aside className="goal-sidebar" aria-label="차곡찬 메뉴"><nav className="workspace-nav" aria-label="주요 화면">
          <button type="button" disabled={interactionLocked} aria-current={workspaceView === "goals" ? "page" : undefined} onClick={returnToBoards}>내 판</button>
          <button type="button" disabled={interactionLocked} aria-current={workspaceView === "connections" ? "page" : undefined} onClick={() => { setWorkspaceView("connections"); setShowPraise(false); }}>연결 관리</button>
          <button type="button" disabled={interactionLocked} aria-current={workspaceView === "shared" ? "page" : undefined} onClick={() => { setWorkspaceView("shared"); setSelectedSharedBoard(null); setShowPraise(false); }}>받은 공유판</button>
          <button type="button" disabled={interactionLocked} aria-current={workspaceView === "trash" ? "page" : undefined} onClick={() => { setWorkspaceView("trash"); setShowPraise(false); }}>휴지통</button>
          <button type="button" disabled={interactionLocked} aria-current={workspaceView === "news" ? "page" : undefined} onClick={() => { setWorkspaceView("news"); setShowPraise(false); }}>소식{hasUnreadNews && <><span className="news-unread-dot" aria-hidden="true" /><span className="visually-hidden">읽지 않은 소식 있음</span></>}</button>
        </nav></aside>
        <section id="workspace-content" className="main-panel" tabIndex={-1} aria-busy={loadingDetail || praiseSending}>
          <div className="status-region" aria-live="polite">{praiseSending && <p role="status">저장 중…</p>}{notice && <p className="notice-banner" role="status">{notice}<button type="button" aria-label="알림 닫기" onClick={() => setNotice("")}>닫기</button></p>}</div>
          {workspaceView === "news" ? <NewsPanel
            tab={newsTab} onTab={setNewsTab} formatDate={shortDate}
            notifications={notifications.items} notificationCursor={notifications.next_cursor} notificationLoading={notifications.loading} notificationError={notifications.error}
            notificationBusyId={notificationBusyId} notificationRowError={notificationRowError}
            onRead={(item) => void readNotification(item)} onConnections={(item) => void readNotification(item, true)}
            onRetryNotifications={() => void loadNotifications(notificationRetry.current.cursor, notificationRetry.current.pageCount)}
            onMoreNotifications={() => { if (notifications.next_cursor) void loadNotifications(notifications.next_cursor); }}
            sentPraises={sentPraises.items} sentCursor={sentPraises.next_cursor} sentLoading={sentPraises.loading} sentError={sentPraises.error} sentRowError={sentRowError}
            cancelTarget={sentCancelTarget} cancelling={cancellingSentPraise} onCancelTarget={(item) => { if (item) setSentRowError(null); setSentCancelTarget(item); }}
            onConfirmCancel={() => void cancelSentPraise()}
            onRetrySent={() => void loadSentPraises(sentRetry.current.cursor, sentRetry.current.pageCount)}
            onMoreSent={() => { if (sentPraises.next_cursor) void loadSentPraises(sentPraises.next_cursor); }}
          /> : workspaceView === "connections" ? <ConnectionsPanel
            loading={connectionLoading} error={connectionError} connections={connections} invites={connectionInvites}
            requests={connectionRequests} blocks={blocks} inviteResult={inviteResult} invitePreview={invitePreview}
            inviteToken={inviteToken} inviteCode={inviteCode} previewError={invitePreviewError}
            previewLoading={invitePreviewLoading} requestAttempt={inviteRequestAttempt !== null}
            onCreateInvite={() => void createInvite()} onPreview={(secret) => void previewInvite(secret)}
            onRefresh={() => void refreshConnectionCenter()} onInviteCodeChange={setInviteCode} onRequest={requestConnection} onClearInvite={clearInviteSecret}
            onResolveRequest={(item, action) => void resolveConnectionRequest(item, action)}
            onDisconnect={(item) => void disconnectConnection(item)} onBlock={(userId) => void blockUser(userId)}
            onRevokeBlock={(item) => void revokeBlock(item)} onRevokeInvite={(item) => void revokeInvite(item)}
          /> : workspaceView === "shared" ? <SharedBoardsPanel
            boards={sharedBoards} cursor={sharedBoardsCursor} loading={sharedBoardsLoading} error={sharedBoardError} selectedBoard={selectedSharedBoard}
            bunches={sharedBunches} bunchCursor={sharedBunchCursor} selectedBunchId={selectedSharedBunchId}
            praises={praises} praiseCursor={praiseCursor} loadingPraises={loadingPraises} message={peerMessage}
            attempt={peerAttempt !== null} sending={peerSending} formError={peerError}
            onSelect={(board) => void openSharedBoard(board.id)} onBack={() => { setSelectedSharedBoard(null); setPraises([]); }}
            onRefresh={() => void loadSharedBoards()} onMoreBoards={() => void loadMoreSharedBoards()} onBunch={(bunchId) => { setSelectedSharedBunchId(bunchId); setSelectedBunchId(bunchId); void loadPraises(selectedSharedBoard?.id ?? "", bunchId); }}
            onMoreBunches={() => void loadMoreSharedBunches()} onMessage={setPeerMessage} onSubmit={submitPeerPraise}
            onRetryPraises={() => void loadPraises(selectedSharedBoard?.id ?? "", selectedSharedBunchId)}
            onMorePraises={() => void loadPraises(selectedSharedBoard?.id ?? "", selectedSharedBunchId, praiseCursor, true)}
          /> : workspaceView === "trash" ? <TrashPanel
            goals={trashGoals} cursor={trashCursor} loading={trashLoading} error={trashError} restoringId={restoringGoalId}
            onRefresh={() => void loadTrashGoals()} onMore={() => trashCursor && void loadTrashGoals(trashCursor, true)} onRestore={(goal) => void restoreGoal(goal)}
          /> : showCreate ? <section className="content-card create-card" aria-labelledby="create-heading">
            <button className="back-link" type="button" disabled={goalSending} onClick={returnToBoards}>판 고르기</button>
            <h1 id="create-heading">판 만들기</h1>
            <div className="selected-template"><div className="mini-grape"><GrapeCluster target={15} filled={4} /></div><div><span className="eyebrow">선택한 판</span><h2>포도판</h2></div></div>
            <form className="stack-form" onSubmit={(event) => void submitGoal(event)}>
              <fieldset disabled={goalSending || Boolean(goalAttempt)}>
                <label htmlFor="goal-title">이름 <span className="required-mark">필수</span></label>
                <input id="goal-title" name="title" autoComplete="off" maxLength={80} required aria-invalid={nameError} aria-describedby={nameError ? "goal-name-error" : "goal-name-hint"} value={goalDraft.title} onInvalid={() => setNameError(true)} onChange={(event) => { setNameError(false); setGoalDraft({ ...goalDraft, title: event.target.value }); }} placeholder="예: 매일 조금씩 걷기" />
                {nameError ? <p id="goal-name-error" className="form-error" role="alert">이름을 확인해 주세요</p> : <p id="goal-name-hint" className="field-hint">1~80자로 적어 주세요.</p>}
                <label htmlFor="personal-target">알 개수</label><input id="personal-target" type="number" min={1} max={100} step={1} required value={goalDraft.personalTarget} onChange={(event) => setGoalDraft({ ...goalDraft, personalTarget: Number(event.target.value) })} />
                <label className="checkbox-row"><input type="checkbox" role="switch" aria-checked={goalDraft.sharedEnabled} checked={goalDraft.sharedEnabled} onChange={(event) => setGoalDraft({ ...goalDraft, sharedEnabled: event.target.checked })} /><span>공유 {goalDraft.sharedEnabled ? "켬" : "끔"}</span></label>
                <p className="field-hint">{goalDraft.sharedEnabled ? "켜면 이 판의 공유판이 함께 만들어져요. 지인은 연결한 뒤 이 판에 초대해야 칭찬할 수 있어요." : "끄면 공유판을 만들지 않아요."}</p>
                <p className="field-hint">공유는 판을 만들 때만 켤 수 있어요. 나중에 켤 수 없어요.</p>
                <details><summary>더 보기</summary><label htmlFor="goal-description">개인 메모 <span className="optional-mark">선택</span></label><textarea id="goal-description" maxLength={1000} rows={3} value={goalDraft.description} onChange={(event) => setGoalDraft({ ...goalDraft, description: event.target.value })} />
                  {goalDraft.sharedEnabled && <><label htmlFor="shared-description">공유 설명 <span className="optional-mark">선택</span></label><textarea id="shared-description" maxLength={1000} rows={2} value={goalDraft.sharedDescription} onChange={(event) => setGoalDraft({ ...goalDraft, sharedDescription: event.target.value })} /></>}
                </details>
              </fieldset>
              {goalFormError && <p className="form-error" role="alert">{goalFormError}</p>}
              {goalAttempt && <p>결과가 불확실하면 같은 요청으로 확인해요. 판이 중복 생성되지 않아요.</p>}
              <div className="form-actions"><button className="button button-secondary" type="button" disabled={goalSending} onClick={returnToBoards}>취소</button><button className="button button-primary" type="submit" disabled={goalSending}>{goalSending ? "저장 중…" : goalAttempt ? "같은 요청으로 다시 확인" : "판 만들기"}</button></div>
            </form>
          </section> : loadingDetail && (!detail || detail.goal.id !== selectedGoalId) ? <div className="loading-panel" role="status"><span className="loading-orbit" aria-hidden="true" /><p>판을 불러오고 있어요.</p></div>
          : !detail && selectedGoalId && detailError ? <section className="welcome-panel"><h1>판을 열지 못했어요</h1><p>{detailError}</p><button className="button button-primary" type="button" onClick={() => void openGoal(selectedGoalId)}>다시 시도</button></section>
          : !detail && <section className="board-directory" aria-labelledby="boards-heading" aria-busy={loadingGoals}>
            <div className="settings-title"><h1 id="boards-heading">판 고르기</h1>{goals.length > 0 && <button className="button button-primary" type="button" onClick={() => { setShowCreate(true); setGoalFormError(""); setNameError(false); }}>새 판 만들기</button>}</div>
            {goalListError && <div className="inline-alert" role="alert">{goalListError}<button type="button" onClick={() => void loadGoals()}>다시 불러오기</button></div>}
            {loadingGoals && <p role="status">판을 불러오고 있어요.</p>}
            {!loadingGoals && goals.length === 0 && !goalListError && <><p>아직 판이 없어요. 판을 하나 골라 시작해요.</p><button className="template-card" type="button" onClick={() => setShowCreate(true)}><span className="mini-grape"><GrapeCluster target={15} filled={4} /></span><span><b>포도판</b><span>알을 눌러 칭찬을 쌓아요</span></span></button></>}
            <div className="goal-list">{goals.map((goal) => {
              const boards = goalDetails[goal.id]?.boards ?? [];
              const personal = boards.find((board) => board.kind === "personal");
              return <button className="goal-card" key={goal.id} type="button" onClick={() => void openGoal(goal.id)}><span className="goal-card-title">{goal.title}</span><span className="status-pill">{goalStatusLabel(goal.status)}</span><span className="goal-card-progress">기록 {boardProgress(personal) ?? "확인 중"}</span>{boards.some((board) => board.kind === "shared") && <span className="badge">공유 켬</span>}</button>;
            })}</div>
            {goalCursor && <button className="text-button" type="button" onClick={() => void loadMoreGoals()}>판 더 보기</button>}
          </section>}
          {workspaceView === "goals" && !showCreate && detail && detail.goal.id === selectedGoalId && selectedGoal && <>
            <div className="goal-header"><div className="goal-heading-copy"><p className="eyebrow">포도판</p><div className="title-row"><h1>{detail.goal.title}</h1><span className="status-pill">{goalStatusLabel(detail.goal.status)}</span></div>{detail.goal.private_description && <p className="goal-description">{detail.goal.private_description}</p>}{!sharedBoard && <p className="field-hint">공유판은 판을 만들 때 켤 수 있어요.</p>}</div></div>
            <fieldset className="goal-actions-fieldset" disabled={interactionLocked}>
                <div className="goal-actions">
                  <button className="button button-secondary" type="button" onClick={() => { setShowCreate(true); setGoalFormError(""); setGoalAttempt(null); }}>새 판</button>
                  <button className="button button-secondary" type="button" onClick={() => { setShowSettings((value) => !value); setDetailError(""); }}>{showSettings ? "설정 닫기" : "판 설정"}</button>
                  {detail.goal.status === "active" && <button className="button button-quiet" type="button" onClick={() => void transitionGoal("complete")}>완료</button>}
                  {detail.goal.status !== "archived" && <button className="button button-quiet" type="button" onClick={() => void transitionGoal("archive")}>보관</button>}
                  {detail.goal.status !== "active" && <button className="button button-primary" type="button" onClick={() => void transitionGoal("resume")}>다시 시작</button>}
                  {deleteAttempt?.goalId === detail.goal.id ? <button className="button button-danger" type="button" disabled={deletingGoal} onClick={() => void deleteGoal(true)}>{deletingGoal ? "확인 중…" : "같은 삭제 다시 확인"}</button> : <button className="button button-quiet danger-link" type="button" disabled={deletingGoal} onClick={() => void deleteGoal()}>{deletingGoal ? "삭제 중…" : "휴지통으로"}</button>}
                </div>
            </fieldset>
              {showSettings && <section className="settings-panel" aria-labelledby="settings-heading">
                <div className="settings-title"><div><p className="eyebrow">GOAL SETTINGS</p><h3 id="settings-heading">판 설정</h3></div><button className="icon-button close-button" type="button" aria-label="설정 닫기" onClick={() => setShowSettings(false)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
                <form className="settings-form" onSubmit={(event) => void saveGoalSettings(event)}>
                  <label htmlFor="edit-goal-title">목표 이름</label><input id="edit-goal-title" name="title" maxLength={80} required defaultValue={detail.goal.title} />
                  <label htmlFor="edit-goal-description">나만의 메모</label><textarea id="edit-goal-description" name="description" maxLength={1000} rows={2} defaultValue={detail.goal.private_description ?? ""} />
                  <button className="button button-secondary" type="submit" disabled={savingSettings}>{savingSettings ? "저장 중…" : "목표 정보 저장"}</button>
                </form>
                {detail.boards.map((board) => <form className="settings-form board-settings" key={board.id} onSubmit={(event) => void saveBoardSettings(event, board)}>
                  <h4>{board.kind === "personal" ? "개인판" : "공유판"}</h4>
                  {board.kind === "shared" && <><label htmlFor={`shared-title-${board.id}`}>공유판 이름</label><input id={`shared-title-${board.id}`} name="sharedTitle" maxLength={80} required defaultValue={board.shared_title ?? ""} /><label htmlFor={`shared-description-${board.id}`}>공유판 소개</label><textarea id={`shared-description-${board.id}`} name="sharedDescription" maxLength={1000} rows={2} defaultValue={board.shared_description ?? ""} /></>}
                  <label htmlFor={`target-${board.id}`}>다음 회차 목표</label><div className="input-suffix"><input id={`target-${board.id}`} name="target" type="number" min={1} max={100} defaultValue={board.next_target_count} /><span>번</span></div>
                  <button className="button button-secondary" type="submit" disabled={savingSettings}>{savingSettings ? "저장 중…" : `${board.kind === "personal" ? "개인판" : "공유판"} 저장`}</button>
                </form>)}
              </section>}


            {detailError && <div className="inline-alert" role="alert"><span>{detailError}</span><button type="button" onClick={() => void refreshCurrentGoal()}>다시 불러오기</button></div>}
            <div className="record-toolbar"><fieldset className="board-tabs" disabled={interactionLocked}><legend className="visually-hidden">기록을 볼 판 선택</legend>{detail.boards.map((board) => <button key={board.id} type="button" aria-pressed={selectedBoardId === board.id} onClick={() => chooseBoard(board)}>{board.kind === "personal" ? "개인 기록" : "받은 칭찬"}</button>)}</fieldset>
              <details className="cycle-picker"><summary>지난 회차 {selectedBunch ? `· ${selectedBunch.cycle_no}회차` : ""}</summary><fieldset className="cycle-list" disabled={interactionLocked}>{selectedBunches.map((bunch) => <button className="cycle-card" type="button" key={bunch.id} aria-pressed={selectedBunchId === bunch.id} onClick={() => chooseBunch(bunch.id)}>{bunch.cycle_no}회차 · {bunch.valid_count} / {bunch.target_count} · {bunch.progress_state === "complete" ? "완성" : "진행 중"}</button>)}{bunchCursors[selectedBoardId] && <button className="text-button" type="button" onClick={() => void loadMoreBunches(selectedBoardId)}>회차 더 보기</button>}</fieldset></details>
            </div>
            <div className="board-workspace">
              <section className="graphic-section" aria-label="선택한 판의 포도 그래픽">
                <p className="record-count"><strong>기록 {selectedBunch?.valid_count ?? 0}</strong><span>/ {selectedBunch?.target_count ?? selectedBoard?.next_target_count ?? 20}</span></p>
                <GrapeCluster target={selectedBunch?.target_count ?? selectedBoard?.next_target_count ?? 20} filled={selectedBunch?.valid_count ?? 0} state={praiseSending ? "saving" : savedInView ? "success" : "idle"} onNext={canAddPraise && selectedBunch?.progress_state !== "complete" ? openPraiseComposer : undefined} />
                {canAddPraise && selectedBunch?.progress_state !== "complete" && <button className="button button-primary button-wide" type="button" disabled={praiseSending} onClick={openPraiseComposer}>칭찬 남기기</button>}
                {canAddPraise && selectedBunch?.progress_state === "complete" && <div className="completion-note" role="status"><h2>이 회차를 완성했어요</h2><p>다음 칭찬은 새 회차에 쌓여요.</p><button className="button button-primary button-wide" type="button" disabled={praiseSending} onClick={openPraiseComposer}>다음 회차 시작하기</button></div>}
                {selectedGoal.status !== "active" && <p className="locked-note">{selectedGoal.status === "completed" ? "완료한 판이에요." : "보관한 판이에요."} 다시 시작하면 칭찬을 쌓을 수 있어요.</p>}
                {selectedBunch && selectedBunch.id !== selectedBoard?.current_bunch?.id && <p className="locked-note">지난 회차는 읽기 전용이에요. 현재 회차를 선택해 기록해 주세요.</p>}
                <p className="privacy-note">{selectedBoard?.kind === "shared" ? "받은 칭찬은 개인 기록과 따로 쌓여요." : "개인 기록은 나에게만 보여요. 공유판과 개수를 합치지 않아요."}</p>
              </section>
              {showPraise && canAddPraise && <div className="composer-panel">{profileError && <div className="inline-alert" role="alert">{profileError}<button type="button" onClick={() => void loadProfile()}>다시 불러오기</button></div>}{nickname !== null ? <PraiseSheet title={detail.goal.title} ordinal={selectedBunch?.progress_state === "complete" ? 1 : (selectedBunch?.valid_count ?? 0) + 1} nickname={nickname} timestamp={praiseTimestamp} message={praiseMessage} date={praiseDate} tags={praiseTags} sending={praiseSending} retry={Boolean(praiseAttempt)} error={praiseFormError} onMessage={setPraiseMessage} onDate={setPraiseDate} onTags={setPraiseTags} onSubmit={submitPraise} onClose={() => setShowPraise(false)} /> : <p role="status">작성자 정보를 확인하고 있어요.</p>}</div>}
              <section className="recent-records" aria-labelledby="recent-records-heading" aria-busy={loadingPraises}>
                <div className="records-heading"><h2 id="recent-records-heading">최근 기록</h2><span>{selectedBunch?.valid_count ?? 0}개</span></div>
                {loadingPraises && <p role="status">기록을 불러오고 있어요.</p>}
                {!loadingPraises && praises.length === 0 && <p className="empty-records">{selectedBoard?.kind === "shared" ? "아직 받은 칭찬이 없어요." : "첫 칭찬을 남겨 보세요."}</p>}
                <ol className="praise-list">{praises.map((praise) => <li key={praise.id} className="praise-entry"><button className="record-open" type="button" onClick={() => { setEditingPraise(null); setRecordDetail(praise); }}><span className="entry-meta"><span>{praise.source === "self" ? "나" : praise.actor_label}</span><time dateTime={praise.recorded_at}>{shortDate(praise.recorded_at)}</time></span><span className="entry-message">{praise.cancelled_at ? "취소한 기록" : praise.message || "칭찬 1건"}</span>{(praise.tags ?? []).map((tag) => <span key={tag} className="badge record-tag">#{tag}</span>)}{praise.excluded_at && <span>회차에서 제외됨</span>}{praise.hidden_at && <span>나에게만 숨김</span>}{savedInView && savedPraise?.id === praise.id && <><span className="badge just-now">방금</span><span className="badge saved-still">저장됨</span></>}</button></li>)}</ol>
                {praiseCursor && <button className="button button-secondary button-wide" type="button" onClick={() => void loadPraises(selectedBoardId, selectedBunchId, praiseCursor, true)}>기록 더 보기</button>}
              </section>
            </div>
          </>}
        </section>
      </div>
      {showShare && sharedBoard && detail && <SharePanel title={detail.goal.title} loadInvites={readShareInvites} createInvite={createShareInvite} revokeInvite={revokeShareInvite} describeError={errorMessage} onClose={() => { setShowShare(false); setManagingBoardId(""); setBoardMembers([]); }}>
        <p>연결된 사람 중 이 판에 허용한 사람만 볼 수 있어요. 연결을 다시 맺어도 이전 권한은 돌아오지 않아요.</p>
        {memberLoading && <p role="status">연결과 권한을 확인하고 있어요.</p>}
        {memberError && <p className="form-error" role="alert">{memberError}</p>}
        <button className="text-button" type="button" onClick={() => void loadBoardMembers(sharedBoard.id)}>권한 목록 다시 불러오기</button>
        {connections.filter((connection) => connection.status === "active" && connection.other_user).length === 0 && <p>먼저 연결을 맺으면 이 판에 허용할 수 있어요.</p>}
        <ul className="member-list">{connections.filter((connection) => connection.status === "active").map((connection) => {
          const person = connection.other_user;
          if (!person) return null;
          const member = boardMembers.find((entry) => entry.user.user_id === person.user_id);
          const granted = member?.status === "active";
          return <li key={person.user_id}><div><b>{person.nickname ?? "연결된 사용자"}</b><span>{granted ? "이 판에 칭찬할 수 있어요" : "아직 허용하지 않았어요"}</span></div><button className="button button-secondary" type="button" disabled={memberLoading || Boolean(memberSaving) || Boolean(memberError)} onClick={() => void changeBoardMember(sharedBoard.id, person.user_id, granted)}>{memberSaving === `${sharedBoard.id}:${person.user_id}` ? "저장 중…" : granted ? "권한 회수" : "공유 허용"}</button></li>;
        })}</ul>
      </SharePanel>}
      {recordDetail && <dialog ref={recordDialog} className="modal-panel record-detail" aria-labelledby="record-detail-heading" onCancel={(event) => { event.preventDefault(); setRecordDetail(null); }}>
        <div className="settings-title"><div><p>{detail?.goal.title}</p><h2 id="record-detail-heading">{recordDetail.cancelled_at ? "취소한 기록" : `${recordOrdinal(recordDetail)}번째 알`}</h2></div><button className="icon-button" type="button" onClick={() => setRecordDetail(null)} aria-label="기록 상세 닫기"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
        {detailError && <p className="form-error" role="alert">{detailError}</p>}
        <p className="detail-message">{recordDetail.cancelled_at ? "취소한 기록 · 메모·실천일·태그가 삭제됐어요." : recordDetail.message || "칭찬 1건"}</p>
        <div className="record-tags">{(recordDetail.tags ?? []).map((tag) => <span key={tag} className="badge record-tag">#{tag}</span>)}</div>
        <dl className="record-definitions"><div><dt>작성자</dt><dd>{recordDetail.actor?.nickname ?? recordDetail.actor_label}</dd></div><div><dt>날짜·시간</dt><dd><time dateTime={recordDetail.recorded_at}>{recordTime(recordDetail.recorded_at)}</time></dd></div>{recordDetail.occurred_on && <div><dt>실천한 날</dt><dd>{shortDate(recordDetail.occurred_on)}</dd></div>}</dl>
        {recordDetail.source === "self" && !recordDetail.cancelled_at && !recordDetail.author_erased_at && <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingPraise({ id: recordDetail.id, message: recordDetail.message ?? "", occurredOn: recordDetail.occurred_on ?? "", tags: recordDetail.tags ?? [] })}>수정</button><button className="text-button" type="button" onClick={() => setCancelTarget(recordDetail)}>기록 취소</button></div>}
        {recordDetail.source === "peer" && !recordDetail.cancelled_at && <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { void moderatePeerPraise(recordDetail, recordDetail.hidden_at ? "unhide" : "hide"); setRecordDetail(null); }}>{recordDetail.hidden_at ? "다시 표시" : "나에게만 숨기기"}</button>{!recordDetail.excluded_at && <button className="button button-secondary" type="button" onClick={() => { void moderatePeerPraise(recordDetail, "exclude"); setRecordDetail(null); }}>회차에서 제외</button>}</div>}
        {editingPraise && <form className="stack-form" onSubmit={savePraiseEdit}><fieldset disabled={savingPraiseEdit}><label htmlFor="edit-praise-message">메모</label><textarea id="edit-praise-message" name="message" maxLength={1000} rows={3} defaultValue={editingPraise.message} /><label htmlFor="edit-praise-date">실천한 날</label><input id="edit-praise-date" name="occurredOn" type="date" defaultValue={editingPraise.occurredOn} /><TagInput key={editingPraise.id} ref={editTagInput} tags={editingPraise.tags} onChange={(tags) => setEditingPraise({ ...editingPraise, tags })} /></fieldset><div className="form-actions"><button className="button button-secondary" type="button" disabled={savingPraiseEdit} onClick={() => setEditingPraise(null)}>취소</button><button className="button button-primary" type="submit" disabled={savingPraiseEdit}>{savingPraiseEdit ? "저장 중…" : "변경 저장"}</button></div></form>}
      </dialog>}
      {cancelTarget && <dialog ref={cancelDialog} className="modal-panel cancel-sheet" aria-labelledby="cancel-record-heading" aria-busy={cancellingPraise} onCancel={(event) => { event.preventDefault(); if (!cancellingPraise) setCancelTarget(null); }}><div className="sheet-handle" aria-hidden="true" /><h2 id="cancel-record-heading">이 기록을 취소할까요?</h2><p>회차 개수에서 빠지고 메모와 실천일·태그는 제거됩니다. 취소한 기록은 되돌릴 수 없어요.</p>{detailError && <p className="form-error" role="alert">{detailError}</p>}<div className="form-actions"><button className="button button-secondary" type="button" disabled={cancellingPraise} onClick={() => setCancelTarget(null)}>취소</button><button className="button button-primary" type="button" disabled={cancellingPraise} onClick={() => void cancelPraise(cancelTarget)}>{cancellingPraise ? "처리 중…" : "확인"}</button></div></dialog>}
    </main>
  );
}
