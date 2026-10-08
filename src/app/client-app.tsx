"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { classifyMutationOutcome, createIdempotentRequest } from "@/client/idempotent-request.mjs";

type GoalStatus = "active" | "completed" | "archived";
type Bunch = { id: string; cycle_no: number; target_count: number; valid_count: number; progress_state: "incomplete" | "complete"; completed_at: string | null };
type GoalSummary = { id: string; title: string; private_description: string | null; status: GoalStatus; revision: number; created_at: string; completed_at: string | null; archived_at: string | null };
type TrashGoal = { id: string; title: string; deleted_at: string; purge_after: string; revision: number };
type Board = { viewer_role: "owner"; id: string; goal_id: string; kind: "personal" | "shared"; revision: number; next_target_count: number; shared_title: string | null; shared_description: string | null; current_bunch: Bunch | null };
type ContributorBoard = { viewer_role: "contributor"; id: string; kind: "shared"; shared_title: string; shared_description: string | null; owner: { user_id: string; nickname: string | null; avatar_key: string | null }; goal_state: GoalStatus; current_bunch: Bunch | null; can_praise: boolean };
type GoalDetail = { goal: GoalSummary; boards: Board[] };
type Praise = { viewer_role: "owner" | "contributor"; id: string; bunch_id: string; source: "self" | "peer"; actor: { user_id: string; nickname: string | null; avatar_key: string | null } | null; actor_label: string; message: string | null; occurred_on: string | null; recorded_at: string; cancelled_at: string | null; hidden_at: string | null; excluded_at: string | null; author_erased_at: string | null };
type Page<T> = { items: T[]; next_cursor: string | null };
type IdempotentAttempt = { key: string; body: Record<string, unknown> };
type Profile = { user_id: string; nickname: string | null; avatar_key: string | null };
type Connection = { id: string; status: "active" | "inactive"; generation: number; other_user: Profile | null };
type InviteMeta = { id: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };
type ConnectionRequest = { id: string; direction: "incoming" | "outgoing"; other_user: Profile | null; status: "pending" | "accepted" | "rejected" | "cancelled" | "expired"; created_at: string; expires_at: string };
type Block = { id: string; blocked_user: Profile; created_at: string };
type BoardMember = { user: Profile; role: "contributor"; status: "active" | "revoked"; connection_generation: number };
type ConnectionInvite = { id: string; link_path: string; code: string; expires_at: string };
type WorkspaceView = "goals" | "connections" | "shared" | "trash";

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
    {!props.loading && props.goals.length === 0 && !props.error ? <div className="empty-records"><b aria-hidden="true">⌑</b><h3>휴지통이 비어 있어요</h3><p>삭제한 목표가 여기에 표시됩니다.</p></div> : null}
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
        {!props.selectedBoard ? <div className="empty-records"><b aria-hidden="true">♡</b><h3>함께할 공유판을 골라 주세요</h3><p>지인이 권한을 준 공유판만 목록에 보여요.</p></div> : <>
          <div className="goal-header"><div className="goal-heading-copy"><p className="eyebrow">{props.selectedBoard.owner.nickname ?? "지인"} 님의 공유판</p><div className="title-row"><h3>{props.selectedBoard.shared_title}</h3><span className={`status-pill status-${props.selectedBoard.goal_state}`}>{goalStatusLabel(props.selectedBoard.goal_state)}</span></div>{props.selectedBoard.shared_description && <p className="goal-description">{props.selectedBoard.shared_description}</p>}</div><button className="button button-secondary" type="button" onClick={props.onBack}>목록으로</button></div>
          {props.selectedBoard.current_bunch && <section className="shared-progress" aria-label="공유판 현재 회차"><div className="board-progress-top"><span className="board-label">현재 회차 진행</span><span className="board-count">{props.selectedBoard.current_bunch.valid_count} / {props.selectedBoard.current_bunch.target_count}</span></div><span className="progress-track" role="progressbar" aria-label="공유판 현재 회차 진행" aria-valuemin={0} aria-valuemax={props.selectedBoard.current_bunch.target_count} aria-valuenow={props.selectedBoard.current_bunch.valid_count}><span style={{ width: `${Math.min(100, props.selectedBoard.current_bunch.valid_count / props.selectedBoard.current_bunch.target_count * 100)}%` }} /></span><span className="progress-caption">개인 기록과 개수를 합산하지 않아요.</span></section>}
          {props.selectedBoard.can_praise ? <section className="praise-composer" aria-labelledby="peer-composer-heading"><div className="composer-heading"><span className="composer-spark" aria-hidden="true">♡</span><div><p className="eyebrow">A WORD FOR YOUR FRIEND</p><h3 id="peer-composer-heading">응원 한마디 보내기</h3></div></div><form onSubmit={props.onSubmit}><fieldset disabled={props.sending || props.attempt}><label className="visually-hidden" htmlFor="peer-praise-message">공유판에 보낼 칭찬</label><textarea id="peer-praise-message" maxLength={1000} rows={3} value={props.message} onChange={(event) => props.onMessage(event.target.value)} placeholder="작은 응원도 큰 힘이 돼요." /></fieldset>{props.formError && <p className="form-error" role="alert">{props.formError}</p>}{props.attempt ? <div className="composer-retry"><p>결과가 불확실해 같은 요청으로 확인해요.</p><button className="button button-primary" type="submit" disabled={props.sending}>{props.sending ? "확인 중…" : "같은 칭찬 다시 확인"}</button><button className="text-button" type="button" onClick={props.onRetryPraises}>기록 새로고침</button></div> : <div className="composer-submit"><p>성공 확인 후 공유판 개수에만 반영돼요.</p><button className="button button-primary" type="submit" disabled={props.sending}>{props.sending ? "보내는 중…" : "칭찬 보내기"}</button></div>}</form></section> : <div className="locked-note"><i aria-hidden="true">◷</i><div><b>{props.selectedBoard.goal_state === "completed" ? "완료된 목표예요" : "보관한 목표예요"}</b><p>이전 기록은 읽을 수 있고 새 칭찬은 보낼 수 없어요.</p></div></div>}
          <div className="record-toolbar"><fieldset className="board-tabs"><legend className="visually-hidden">공유 회차 선택</legend>{props.bunches.map((bunch) => <button key={bunch.id} type="button" className={props.selectedBunchId === bunch.id ? "active" : ""} aria-pressed={props.selectedBunchId === bunch.id} onClick={() => props.onBunch(bunch.id)}>{bunch.cycle_no}회차 · {bunch.valid_count}/{bunch.target_count}</button>)}</fieldset>{currentBunch && <p className="cycle-label">{currentBunch.progress_state === "complete" ? "완성" : "진행 중"}</p>}</div>
          {props.bunchCursor && <button className="text-button history-more" type="button" onClick={props.onMoreBunches}>지난 회차 더 보기</button>}
          <div className="records-heading"><div><p className="eyebrow">PRAISES I SENT</p><h3>내가 보낸 칭찬</h3></div><span className="record-total">{currentBunch ? `${currentBunch.valid_count}개` : "기록 없음"}</span></div>
          {props.loadingPraises && <p className="loading-inline" role="status">보낸 칭찬을 불러오고 있어요.</p>}
          {!props.loadingPraises && props.praises.length === 0 && <div className="empty-records"><b aria-hidden="true">♡</b><h4>이 회차에 보낸 칭찬이 없어요</h4><p>첫 응원을 보내면 이곳에 표시돼요.</p></div>}
          <ol className="praise-list" aria-label="내가 보낸 공유 칭찬">{props.praises.map((praise) => <li className={`praise-entry ${praise.cancelled_at ? "cancelled" : ""}`} key={praise.id}><span className="entry-marker peer-marker" aria-hidden="true">♡</span><div className="entry-content"><div className="entry-meta"><span>내가 보낸 칭찬</span><time dateTime={praise.recorded_at}>{shortDate(praise.recorded_at)}</time></div>{praise.cancelled_at ? <p className="cancelled-copy">취소된 칭찬이에요.</p> : <p className="entry-message">{praise.message || "짧은 마음을 남겼어요."}</p>}</div></li>)}</ol>
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
    throw new Error("서버 응답을 받지 못했습니다. 연결을 확인해 주세요.");
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

function newRequestKey() {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

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

function boardProgress(board: Board | undefined, status: GoalStatus) {
  if (!board) return null;
  if (!board.current_bunch) return status === "active" ? `0/${board.next_target_count}` : null;
  return `${board.current_bunch.valid_count}/${board.current_bunch.target_count}`;
}

export default function ChagokchanApp() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("goals");
  const [theme, setTheme] = useState<"garden" | "grape">("garden");
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
  const [goalDraft, setGoalDraft] = useState({ title: "", description: "", personalTarget: 20, sharedEnabled: false, sharedTitle: "", sharedDescription: "", sharedTarget: 10 });
  const [goalAttempt, setGoalAttempt] = useState<IdempotentAttempt | null>(null);
  const [goalSending, setGoalSending] = useState(false);
  const [goalFormError, setGoalFormError] = useState("");
  const [praiseMessage, setPraiseMessage] = useState("");
  const [praiseDate, setPraiseDate] = useState(localToday());
  const [praiseAttempt, setPraiseAttempt] = useState<IdempotentAttempt | null>(null);
  const [praiseSending, setPraiseSending] = useState(false);
  const [praiseFormError, setPraiseFormError] = useState("");
  const [editingPraise, setEditingPraise] = useState<{ id: string; message: string; occurredOn: string } | null>(null);
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

  useEffect(() => {
    if (theme === "grape") document.documentElement.dataset.theme = "grape";
    else delete document.documentElement.dataset.theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

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
      const page = await apiJson<Page<GoalSummary>>(`/api/v1/goals?${query.toString()}`);
      setGoals((previous) => append ? [...previous, ...page.items] : page.items);
      setGoalCursor(page.next_cursor);
      void Promise.allSettled(page.items.map((goal) => getGoalDetail(goal.id)))
        .then((results) => {
          const details = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
          setGoalDetails((previous) => ({ ...previous, ...Object.fromEntries(details.map((item) => [item.goal.id, item])) }));
        });
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
    selectedGoalIdRef.current = goalId;
    setSelectedGoalId(goalId);
    setLoadingDetail(true);
    setDetailError("");
    setNotice("");
    setShowCreate(false);
    setShowSettings(false);
    try {
      const nextDetail = await getGoalDetail(goalId);
      const bunchPages = await Promise.all(nextDetail.boards.map(async (board) => {
        const query = new URLSearchParams({ limit: "50" });
        const page = await apiJson<Page<Bunch>>(`/api/v1/boards/${board.id}/bunches?${query.toString()}`);
        return [board.id, page] as const;
      }));
      if (requestSeq !== goalRequestSeq.current) return;
      const nextBunches = Object.fromEntries(bunchPages.map(([boardId, page]) => [boardId, page.items]));
      const nextCursors = Object.fromEntries(bunchPages.map(([boardId, page]) => [boardId, page.next_cursor]));
      const personal = nextDetail.boards.find((board) => board.kind === "personal");
      const nextBoard = nextDetail.boards.find((board) => board.id === preferredBoardId) ?? personal ?? nextDetail.boards[0];
      const boardBunches = nextBunches[nextBoard.id] ?? [];
      const nextBunchId = (preferredBunchId && boardBunches.some((bunch: Bunch) => bunch.id === preferredBunchId) ? preferredBunchId : null)
        ?? nextBoard.current_bunch?.id
        ?? boardBunches[0]?.id
        ?? "";
      setDetail(nextDetail);
      setGoalDetails((previous) => ({ ...previous, [goalId]: nextDetail }));
      setBunchesByBoard((previous) => ({ ...previous, ...nextBunches }));
      setBunchCursors((previous) => ({ ...previous, ...nextCursors }));
      setSelectedBoardId(nextBoard.id);
      setSelectedBunchId(nextBunchId);
      setEditingPraise(null);
      await loadPraises(nextBoard.id, nextBunchId);
    } catch (error) {
      if (requestSeq !== goalRequestSeq.current) return;
      setDetail(null);
      setDetailError(errorMessage(error));
    } finally {
      if (requestSeq === goalRequestSeq.current) setLoadingDetail(false);
    }
  }, [loadPraises]);

  useEffect(() => { void loadGoals(); }, [loadGoals]);
  useEffect(() => {
    if (!showCreate && !selectedGoalIdRef.current && goals[0]) void openGoal(goals[0].id);
  }, [goals, openGoal, showCreate]);

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
    try {
      const page = await apiJson<Page<BoardMember>>(`/api/v1/boards/${boardId}/members?limit=50`);
      setBoardMembers(page.items);
      const connectionPage = await apiJson<Page<Connection>>("/api/v1/connections?limit=50");
      setConnections(connectionPage.items);
    } catch (error) { setMemberError(errorMessage(error)); setBoardMembers([]); }
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
    setGoalFormError("");
    const payload: Record<string, unknown> = goalAttempt?.body ?? {
      title: goalDraft.title,
      private_description: goalDraft.description || null,
      personal_target_count: Number(goalDraft.personalTarget),
      ...(goalDraft.sharedEnabled ? { shared_board: {
        title: goalDraft.sharedTitle,
        description: goalDraft.sharedDescription || null,
        target_count: Number(goalDraft.sharedTarget),
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
      setGoalDraft({ title: "", description: "", personalTarget: 20, sharedEnabled: false, sharedTitle: "", sharedDescription: "", sharedTarget: 10 });
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

  async function submitPraise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedBoard?.kind !== "personal" || selectedGoal?.status !== "active") return;
    setPraiseFormError("");
    const payload: Record<string, unknown> = praiseAttempt?.body ?? {
      message: praiseMessage.trim() || null,
      occurred_on: praiseDate || null,
    };
    const attempt = createIdempotentRequest(payload, praiseAttempt, newRequestKey);
    setPraiseAttempt(attempt);
    setPraiseSending(true);
    try {
      const result = await mutate<{ id: string; bunch_id: string; replayed: boolean }>(`/api/v1/boards/${selectedBoard.id}/praises`, "POST", attempt.body, attempt.key);
      setPraiseAttempt(null);
      setPraiseMessage("");
      setPraiseDate(localToday());
      setNotice(result.replayed ? "이전에 보낸 요청이 기록된 것을 확인했어요." : "오늘의 칭찬을 기록했어요.");
      await loadGoals();
      await openGoal(selectedGoal.id, selectedBoard.id, result.bunch_id);
    } catch (error) {
      const outcome = mutationOutcome(error);
      if (outcome === "retry_same_key") {
        setPraiseFormError(`${errorMessage(error)} 응답이 불확실해요. 같은 요청 키와 내용을 유지했습니다.`);
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
    if (!editingPraise) return;
    const form = new FormData(event.currentTarget);
    setSavingPraiseEdit(true);
    try {
      await mutate(`/api/v1/praises/${editingPraise.id}`, "PATCH", {
        message: String(form.get("message") ?? "") || null,
        occurred_on: String(form.get("occurredOn") ?? "") || null,
      });
      setEditingPraise(null);
      setNotice("기록을 수정했어요.");
      await loadPraises(selectedBoardId, selectedBunchId);
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setSavingPraiseEdit(false);
    }
  }

  async function cancelPraise(praise: Praise) {
    if (!window.confirm("이 기록을 취소할까요? 회차 개수에서 빠지고 메모와 실천일은 제거됩니다.")) return;
    try {
      await mutate(`/api/v1/praises/${praise.id}/cancel`, "POST", {});
      setNotice("기록을 취소했어요. 해당 메모와 실천일은 삭제됐습니다.");
      await loadGoals();
      await refreshCurrentGoal();
    } catch (error) {
      setDetailError(errorMessage(error));
    }
  }

  function chooseBoard(board: Board) {
    setSelectedBoardId(board.id);
    const nextBunchId = board.current_bunch?.id ?? bunchesByBoard[board.id]?.[0]?.id ?? "";
    setSelectedBunchId(nextBunchId);
    setEditingPraise(null);
    void loadPraises(board.id, nextBunchId);
  }

  function chooseBunch(bunchId: string) {
    setSelectedBunchId(bunchId);
    setEditingPraise(null);
    void loadPraises(selectedBoardId, bunchId);
  }

  return (
    <main id="app-shell" className="app-shell">
      <a className="skip-link" href="#workspace-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="차곡찬 홈">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">차곡찬</span>
        </a>
        <p className="topbar-note">나를 알아보는 작은 기록</p>
        <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "garden" ? "grape" : "garden")}
          aria-label="화면 색상 테마" aria-pressed={theme === "grape"}>
          테마 · {theme === "garden" ? "정원" : "포도"}
        </button>
        <span className="profile-chip">오늘도 나</span>
      </header>

      <div className="workspace">
        <aside className={`goal-sidebar ${workspaceView === "goals" && selectedGoalId ? "has-selection" : ""}`} aria-label="차곡찬 메뉴">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">CHAGOKCHAN</p>
              <h1>{workspaceView === "goals" ? "내 목표" : workspaceView === "connections" ? "연결" : workspaceView === "shared" ? "받은 공유판" : "휴지통"}</h1>
            </div>
            {workspaceView === "goals" && <button className="icon-button add-button" type="button" aria-label="새 목표 만들기" onClick={() => { setShowCreate(true); setGoalFormError(""); setGoalAttempt(null); }}>
              <span aria-hidden="true">＋</span>
            </button>}
          </div>

          <nav className="workspace-nav" aria-label="주요 화면">
            <button type="button" aria-current={workspaceView === "goals" ? "page" : undefined} className={workspaceView === "goals" ? "active" : ""} onClick={() => setWorkspaceView("goals")}>내 목표</button>
            <button type="button" aria-current={workspaceView === "connections" ? "page" : undefined} className={workspaceView === "connections" ? "active" : ""} onClick={() => setWorkspaceView("connections")}>연결 관리</button>
            <button type="button" aria-current={workspaceView === "shared" ? "page" : undefined} className={workspaceView === "shared" ? "active" : ""} onClick={() => { setWorkspaceView("shared"); setSelectedSharedBoard(null); }}>받은 공유판</button>
            <button type="button" aria-current={workspaceView === "trash" ? "page" : undefined} className={workspaceView === "trash" ? "active" : ""} onClick={() => setWorkspaceView("trash")}>휴지통</button>
          </nav>

          {workspaceView === "goals" ? <>
          {goalListError && <div className="inline-alert" role="alert"><span>{goalListError}</span><button type="button" onClick={() => void loadGoals()}>다시 불러오기</button></div>}
          {loadingGoals && goals.length === 0 ? <div className="skeleton-list" role="status"><span className="visually-hidden">목표를 불러오는 중</span><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div> : null}
          {!loadingGoals && goals.length === 0 && !goalListError ? (
            <section className="empty-sidebar">
              <span className="empty-spark" aria-hidden="true">✳</span>
              <h2>첫 목표를 만들어 볼까요?</h2>
              <p>작은 바람도 목표가 되면 차곡차곡 쌓여요.</p>
              <button className="button button-primary button-wide" type="button" onClick={() => setShowCreate(true)}>목표 시작하기</button>
            </section>
          ) : null}
          <nav className="goal-list" aria-label="목표 목록" aria-busy={loadingGoals}>
            {goals.map((goal) => {
              const boards = goalDetails[goal.id]?.boards ?? [];
              const personal = boards.find((board) => board.kind === "personal");
              const shared = boards.find((board) => board.kind === "shared");
              return (
                <button key={goal.id} className={`goal-card ${selectedGoalId === goal.id ? "selected" : ""}`} type="button" aria-current={selectedGoalId === goal.id ? "page" : undefined} onClick={() => void openGoal(goal.id)}>
                  <span className="goal-card-title">{goal.title}</span>
                  <span className={`status-pill status-${goal.status}`}>{goalStatusLabel(goal.status)}</span>
                  <span className="goal-card-progress">
                    <span>개인 <b>{boardProgress(personal, goal.status) ?? "—"}</b></span>
                    {shared ? <span>공유 <b>{boardProgress(shared, goal.status) ?? "—"}</b></span> : null}
                  </span>
                </button>
              );
            })}
          </nav>
          {goalCursor && <button className="text-button load-more" type="button" onClick={() => void loadMoreGoals()}>목표 더 보기</button>}
          <p className="sidebar-footnote">개인판과 공유판은 각각 따로 쌓여요.</p>
          </> : <p className="sidebar-footnote">{workspaceView === "trash" ? "복구 기한은 삭제 후 30일이에요." : "연결과 공유판 권한은 각각 따로 관리해요."}</p>}
        </aside>

        <section id="workspace-content" className="main-panel" aria-label="목표와 기록" tabIndex={-1}>
          {notice && <p className="notice-banner" role="status">{notice}<button type="button" aria-label="알림 닫기" onClick={() => setNotice("")}>닫기</button></p>}

          {workspaceView === "connections" ? <ConnectionsPanel
            loading={connectionLoading} error={connectionError} connections={connections} invites={connectionInvites}
            requests={connectionRequests} blocks={blocks} inviteResult={inviteResult} invitePreview={invitePreview}
            inviteToken={inviteToken} inviteCode={inviteCode} previewError={invitePreviewError}
            previewLoading={invitePreviewLoading} requestAttempt={inviteRequestAttempt !== null}
            onCreateInvite={() => void createInvite()} onPreview={(secret) => void previewInvite(secret)}
            onRefresh={() => void refreshConnectionCenter()}
            onInviteCodeChange={setInviteCode} onRequest={requestConnection} onClearInvite={clearInviteSecret}
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
          /> : showCreate ? (
            <section className="content-card create-card" aria-labelledby="create-heading">
              <button className="back-link mobile-only" type="button" onClick={() => setShowCreate(false)}>← 목표 목록</button>
              <p className="eyebrow">A SMALL START</p>
              <h2 id="create-heading">새 목표를 시작해요</h2>
              <p className="section-intro">나를 위한 목표부터 천천히 적어 보세요. 공유판은 나중에 따로 열 수 있어요.</p>
              <form className="stack-form" onSubmit={(event) => void submitGoal(event)}>
                <fieldset disabled={goalSending || Boolean(goalAttempt)}>
                  <label htmlFor="goal-title">목표 이름 <span className="required-mark">필수</span></label>
                  <input id="goal-title" name="title" autoComplete="off" maxLength={80} required value={goalDraft.title} onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })} placeholder="예: 매일 조금씩 걷기" />
                  <label htmlFor="goal-description">나만의 메모 <span className="optional-mark">선택</span></label>
                  <textarea id="goal-description" name="description" maxLength={1000} rows={3} value={goalDraft.description} onChange={(event) => setGoalDraft({ ...goalDraft, description: event.target.value })} placeholder="이 목표를 시작한 이유를 적어도 좋아요." />
                  <label htmlFor="personal-target">개인판 회차 목표</label>
                  <div className="input-suffix"><input id="personal-target" type="number" min={1} max={100} value={goalDraft.personalTarget} onChange={(event) => setGoalDraft({ ...goalDraft, personalTarget: Number(event.target.value) })} /><span>번의 칭찬</span></div>
                  <label className="checkbox-row"><input type="checkbox" checked={goalDraft.sharedEnabled} onChange={(event) => setGoalDraft({ ...goalDraft, sharedEnabled: event.target.checked })} /><span>나중에 공유할 판도 함께 준비하기</span></label>
                  {goalDraft.sharedEnabled && <div className="shared-fields">
                    <label htmlFor="shared-title">공유판 이름</label>
                    <input id="shared-title" maxLength={80} required value={goalDraft.sharedTitle} onChange={(event) => setGoalDraft({ ...goalDraft, sharedTitle: event.target.value })} placeholder="예: 함께 응원해요" />
                    <label htmlFor="shared-description">공유판 소개 <span className="optional-mark">선택</span></label>
                    <textarea id="shared-description" maxLength={1000} rows={2} value={goalDraft.sharedDescription} onChange={(event) => setGoalDraft({ ...goalDraft, sharedDescription: event.target.value })} />
                    <label htmlFor="shared-target">공유판 회차 목표</label>
                    <div className="input-suffix"><input id="shared-target" type="number" min={1} max={100} value={goalDraft.sharedTarget} onChange={(event) => setGoalDraft({ ...goalDraft, sharedTarget: Number(event.target.value) })} /><span>번의 칭찬</span></div>
                    <p className="field-hint">공유판을 만들더라도 개인판 기록과 개수는 독립적으로 유지돼요.</p>
                  </div>}
                </fieldset>
                {goalFormError && <p className="form-error" role="alert">{goalFormError}</p>}
                {goalAttempt && <div className="retry-panel" role="status"><p>응답을 받지 못해 요청 결과를 확인 중이에요. 같은 내용으로 다시 보내면 중복 목표가 생기지 않아요.</p><button className="button button-secondary" type="submit" disabled={goalSending}>{goalSending ? "확인 중…" : "같은 요청으로 다시 확인"}</button></div>}
                {!goalAttempt && <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowCreate(false)}>취소</button><button className="button button-primary" type="submit" disabled={goalSending}>{goalSending ? "저장 중…" : "목표 만들기"}</button></div>}
              </form>
            </section>
          ) : loadingDetail ? (
            <div className="loading-panel" role="status"><span className="loading-orbit" aria-hidden="true" /><p>목표를 불러오고 있어요.</p></div>
          ) : !detail && selectedGoalId && detailError ? (
            <section className="welcome-panel"><span className="welcome-mark" aria-hidden="true">⌑</span><h2>목표를 열지 못했어요</h2><p>{detailError}</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { selectedGoalIdRef.current = null; setSelectedGoalId(null); setDetailError(""); }}>목표 목록</button><button className="button button-primary" type="button" onClick={() => void openGoal(selectedGoalId)}>다시 시도</button></div></section>
          ) : detail && selectedGoal ? (
            <>
              <div className="goal-header">
                <button className="back-link mobile-only" type="button" onClick={() => { goalRequestSeq.current += 1; selectedGoalIdRef.current = null; setSelectedGoalId(null); setDetail(null); setLoadingDetail(false); }}>← 목표 목록</button>
                <div className="goal-heading-copy">
                  <p className="eyebrow">A GOAL TO GROW</p>
                  <div className="title-row"><h2>{detail.goal.title}</h2><span className={`status-pill status-${detail.goal.status}`}>{goalStatusLabel(detail.goal.status)}</span></div>
                  {detail.goal.private_description && <p className="goal-description">{detail.goal.private_description}</p>}
                </div>
                <div className="goal-actions">
                  <button className="button button-secondary" type="button" onClick={() => { setShowCreate(true); setGoalFormError(""); setGoalAttempt(null); }}>새 목표</button>
                  <button className="button button-secondary" type="button" onClick={() => { setShowSettings((value) => !value); setDetailError(""); }}>{showSettings ? "설정 닫기" : "목표 설정"}</button>
                  {detail.goal.status === "active" && <button className="button button-quiet" type="button" onClick={() => void transitionGoal("complete")}>완료</button>}
                  {detail.goal.status !== "archived" && <button className="button button-quiet" type="button" onClick={() => void transitionGoal("archive")}>보관</button>}
                  {detail.goal.status !== "active" && <button className="button button-primary" type="button" onClick={() => void transitionGoal("resume")}>다시 시작</button>}
                  {deleteAttempt?.goalId === detail.goal.id ? <button className="button button-danger" type="button" disabled={deletingGoal} onClick={() => void deleteGoal(true)}>{deletingGoal ? "확인 중…" : "같은 삭제 다시 확인"}</button> : <button className="button button-quiet danger-link" type="button" disabled={deletingGoal} onClick={() => void deleteGoal()}>{deletingGoal ? "삭제 중…" : "휴지통으로"}</button>}
                </div>
              </div>

              {showSettings && <section className="settings-panel" aria-labelledby="settings-heading">
                <div className="settings-title"><div><p className="eyebrow">GOAL SETTINGS</p><h3 id="settings-heading">목표와 판 설정</h3></div><button className="icon-button close-button" type="button" aria-label="설정 닫기" onClick={() => setShowSettings(false)}>×</button></div>
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
                {detail.boards.filter((board) => board.kind === "shared").map((board) => <section className="member-manager" key={`members-${board.id}`} aria-labelledby={`members-heading-${board.id}`}>
                  <div className="settings-title"><div><p className="eyebrow">SHARE ACCESS</p><h4 id={`members-heading-${board.id}`}>공유 대상</h4></div><button className="button button-secondary" type="button" onClick={() => managingBoardId === board.id ? setManagingBoardId("") : void loadBoardMembers(board.id)}>{managingBoardId === board.id ? "권한 관리 닫기" : "권한 관리"}</button></div>
                  {managingBoardId === board.id && <>
                    <p className="field-hint">연결된 사람 중 공유판에 초대한 대상만 볼 수 있어요. 연결을 다시 맺어도 회수한 권한은 복구되지 않아요.</p>
                    {memberError && <p className="form-error" role="alert">{memberError}</p>}
                    {connections.filter((connection) => connection.status === "active" && connection.other_user).length === 0 ? <p className="history-empty">먼저 연결을 맺으면 공유 대상으로 선택할 수 있어요.</p> : <ul className="member-list">
                      {connections.filter((connection) => connection.status === "active" && connection.other_user).map((connection) => {
                        const person = connection.other_user;
                        if (!person) return null;
                        const member = boardMembers.find((entry) => entry.user.user_id === person.user_id);
                        const hasGrant = member?.status === "active";
                        const mutationId = `${board.id}:${person.user_id}`;
                        return <li key={person.user_id}><div><b>{person.nickname ?? "연결된 사용자"}</b><span>{hasGrant ? "이 공유판을 볼 수 있어요" : member ? "이전 권한은 회수됐어요" : "아직 이 판은 볼 수 없어요"}</span></div><button className={`button ${hasGrant ? "button-secondary" : "button-primary"}`} type="button" disabled={memberSaving === mutationId} onClick={() => void changeBoardMember(board.id, person.user_id, hasGrant)}>{memberSaving === mutationId ? "저장 중…" : hasGrant ? "권한 회수" : "공유 허용"}</button></li>;
                      })}
                    </ul>}
                  </>}
                </section>)}
              </section>}

              {detailError && <div className="inline-alert detail-alert" role="alert"><span>{detailError}</span><button type="button" onClick={() => void refreshCurrentGoal()}>다시 불러오기</button></div>}

              <section className="progress-section" aria-label="판별 진행 상황">
                {detail.boards.map((board) => {
                  const bunch = board.current_bunch;
                  return <button className={`board-progress ${selectedBoardId === board.id ? "active-board" : ""}`} type="button" key={board.id} onClick={() => chooseBoard(board)} aria-pressed={selectedBoardId === board.id}>
                    <span className="board-progress-top"><span className="board-label">{board.kind === "personal" ? "나의 개인판" : "함께 나누는 공유판"}</span><span className="board-count">{bunch ? `${bunch.valid_count} / ${bunch.target_count}` : "첫 회차 전"}</span></span>
                    <span className="progress-track" role="progressbar" aria-label={`${board.kind === "personal" ? "개인판" : "공유판"} 진행`} aria-valuemin={0} aria-valuemax={bunch?.target_count ?? board.next_target_count} aria-valuenow={bunch?.valid_count ?? 0}><span style={{ width: `${bunch ? Math.min(100, bunch.valid_count / bunch.target_count * 100) : 0}%` }} /></span>
                    <span className="progress-caption">{bunch ? `${bunch.cycle_no}회차 · ${bunch.progress_state === "complete" ? "완성" : "차곡차곡 쌓는 중"}` : `다음 회차 목표 ${board.next_target_count}번`}</span>
                  </button>;
                })}
              </section>

              <div className="record-toolbar">
                <fieldset className="board-tabs">
                  <legend className="visually-hidden">기록을 볼 판 선택</legend>
                  {detail.boards.map((board) => <button key={board.id} type="button" aria-pressed={selectedBoardId === board.id} className={selectedBoardId === board.id ? "active" : ""} onClick={() => chooseBoard(board)}>{board.kind === "personal" ? "개인 기록" : "받은 칭찬"}</button>)}
                </fieldset>
                {selectedBunch && <p className="cycle-label">{selectedBunch.cycle_no}회차 <em>{selectedBunch.progress_state === "complete" ? "완성" : "진행 중"}</em></p>}
              </div>

              <div className="record-layout">
                <section className="record-column" aria-label="선택한 회차 기록">
                  {selectedBoard?.kind === "personal" && selectedGoal.status === "active" && (!selectedBunch || selectedBunch.id === selectedBoard.current_bunch?.id) && <section className="praise-composer" aria-labelledby="composer-heading">
                    <div className="composer-heading"><span className="composer-spark" aria-hidden="true">✳</span><div><p className="eyebrow">A KIND WORD TO YOURSELF</p><h3 id="composer-heading">오늘의 나를 칭찬해요</h3></div></div>
                    <form onSubmit={(event) => void submitPraise(event)}>
                      <fieldset disabled={praiseSending || Boolean(praiseAttempt)}>
                        <label className="visually-hidden" htmlFor="praise-message">나에게 남길 칭찬 메모</label>
                        <textarea id="praise-message" maxLength={1000} rows={3} value={praiseMessage} onChange={(event) => setPraiseMessage(event.target.value)} placeholder="작은 일도 좋아요. 오늘 해낸 일을 적어 보세요." />
                        <div className="composer-bottom"><label htmlFor="praise-date">실천한 날 <span className="optional-mark">선택</span></label><input id="praise-date" type="date" value={praiseDate} onChange={(event) => setPraiseDate(event.target.value)} /></div>
                      </fieldset>
                      {praiseFormError && <p className="form-error" role="alert">{praiseFormError}</p>}
                      {praiseAttempt ? <div className="composer-retry"><p>기록 결과를 확인 중이에요. 입력을 바꾸지 않고 같은 요청으로 확인해요.</p><button className="button button-primary" type="submit" disabled={praiseSending}>{praiseSending ? "확인 중…" : "같은 기록 다시 확인"}</button><button className="text-button" type="button" onClick={() => void loadPraises(selectedBoard.id, selectedBunchId)}>기록 목록 새로고침</button></div>
                        : <div className="composer-submit"><p>성공 확인 후에만 개수에 반영돼요.</p><button className="button button-primary" type="submit" disabled={praiseSending || selectedBunch?.progress_state === "complete"}>{praiseSending ? "기록 중…" : "칭찬 쌓기"}<span aria-hidden="true"> ↗</span></button></div>}
                    </form>
                  </section>}

                  {selectedBoard?.kind === "personal" && selectedGoal.status !== "active" && <div className="locked-note"><i aria-hidden="true">◷</i><div><b>{selectedGoal.status === "completed" ? "완료된 목표예요" : "보관한 목표예요"}</b><p>이전 기록은 볼 수 있고, 새 칭찬은 다시 시작한 뒤 쌓을 수 있어요.</p></div></div>}
                  {selectedBoard?.kind === "personal" && selectedGoal.status === "active" && selectedBunch && selectedBunch.id !== selectedBoard.current_bunch?.id && <div className="locked-note"><i aria-hidden="true">◷</i><div><b>지난 회차는 읽기 전용이에요</b><p>새 칭찬은 현재 회차에 쌓여요. 개인판에서 현재 회차를 선택해 기록할 수 있어요.</p></div></div>}
                  {selectedBoard?.kind === "shared" && <div className="shared-note"><i aria-hidden="true">♡</i><p>공유판 칭찬은 개인 기록과 별도로 쌓여요. 이 화면에서는 받은 기록을 볼 수 있어요.</p></div>}

                  <div className="records-heading"><div><p className="eyebrow">YOUR NOTES</p><h3>{selectedBoard?.kind === "shared" ? "받은 칭찬" : "차곡차곡 쌓인 기록"}</h3></div><span className="record-total">{selectedBunch ? `${selectedBunch.valid_count}개` : "기록 없음"}</span></div>
                  {loadingPraises && <p className="loading-inline" role="status">기록을 불러오고 있어요.</p>}
                  {!loadingPraises && praises.length === 0 && <div className="empty-records"><b aria-hidden="true">✳</b><h4>{selectedBoard?.kind === "shared" ? "아직 도착한 칭찬이 없어요" : "첫 칭찬을 기다리고 있어요"}</h4><p>{selectedBoard?.kind === "shared" ? "친구가 이 목표를 응원하면 여기에 보여요." : "오늘 해낸 작은 일부터 기록해 보세요."}</p></div>}
                  <ol className="praise-list" aria-label="칭찬 기록 목록">
                    {praises.map((praise) => {
                      const canEdit = praise.source === "self" && praise.cancelled_at === null && praise.author_erased_at === null && selectedBoard?.kind === "personal";
                      const isCancelled = praise.cancelled_at !== null;
                      const isExcluded = praise.excluded_at !== null;
                      return <li className={`praise-entry ${isCancelled ? "cancelled" : ""}`} key={praise.id}>
                        <span className={`entry-marker ${praise.source === "peer" ? "peer-marker" : ""}`} aria-hidden="true">{isCancelled ? "–" : praise.source === "peer" ? "♡" : "✳"}</span>
                        <div className="entry-content">
                          <div className="entry-meta"><span>{praise.source === "self" ? "나" : praise.actor_label || "친구"}</span><time dateTime={praise.recorded_at}>{shortDate(praise.recorded_at)}</time></div>
                          {isCancelled ? <p className="cancelled-copy">취소한 기록 · 본문과 실천일이 삭제됐어요.</p> : <>
                            {praise.message ? <p className="entry-message">{praise.message}</p> : <p className="entry-message quiet-message">짧은 마음을 남겼어요.</p>}
                            {praise.occurred_on && <p className="entry-date">실천한 날 {shortDate(praise.occurred_on)}</p>}
                            {isExcluded && <p className="entry-date">회차 개수에서 제외된 기록</p>}
                            {praise.hidden_at && <p className="entry-date">나에게만 숨긴 기록</p>}
                          </>}
                          {canEdit && <div className="entry-actions"><button className="text-button" type="button" onClick={() => setEditingPraise({ id: praise.id, message: praise.message ?? "", occurredOn: praise.occurred_on ?? "" })}>수정</button><button className="text-button danger-link" type="button" onClick={() => void cancelPraise(praise)}>취소</button></div>}
                          {selectedBoard?.kind === "shared" && praise.source === "peer" && !isCancelled && <div className="entry-actions"><button className="text-button" type="button" onClick={() => void moderatePeerPraise(praise, praise.hidden_at ? "unhide" : "hide")}>{praise.hidden_at ? "다시 표시" : "나에게만 숨기기"}</button>{!isExcluded && <button className="text-button danger-link" type="button" onClick={() => void moderatePeerPraise(praise, "exclude")}>회차에서 제외</button>}</div>}
                          {editingPraise?.id === praise.id && <form className="edit-praise-form" onSubmit={(event) => void savePraiseEdit(event)}>
                            <label htmlFor={`edit-message-${praise.id}`}>칭찬 메모</label><textarea id={`edit-message-${praise.id}`} name="message" maxLength={1000} rows={3} defaultValue={editingPraise.message} />
                            <label htmlFor={`edit-date-${praise.id}`}>실천한 날</label><input id={`edit-date-${praise.id}`} name="occurredOn" type="date" defaultValue={editingPraise.occurredOn} />
                            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingPraise(null)}>취소</button><button className="button button-primary" type="submit" disabled={savingPraiseEdit}>{savingPraiseEdit ? "저장 중…" : "변경 저장"}</button></div>
                          </form>}
                        </div>
                      </li>;
                    })}
                  </ol>
                  {praiseCursor && <button className="button button-secondary button-wide" type="button" onClick={() => void loadPraises(selectedBoardId, selectedBunchId, praiseCursor, true)}>기록 더 보기</button>}
                </section>

                <aside className="history-column" aria-labelledby="history-heading">
                  <div className="history-heading"><div><p className="eyebrow">YOUR JOURNEY</p><h3 id="history-heading">지난 회차</h3></div><span className="history-count">{selectedBunches.length}</span></div>
                  {selectedBunches.length === 0 ? <p className="history-empty">아직 시작한 회차가 없어요.</p> : <ol className="cycle-list">
                    {selectedBunches.map((bunch) => <li key={bunch.id}>
                      <button className={`cycle-card ${selectedBunchId === bunch.id ? "current" : ""}`} type="button" aria-pressed={selectedBunchId === bunch.id} onClick={() => chooseBunch(bunch.id)}>
                        <span className="cycle-number">{bunch.cycle_no}회차</span><span className="cycle-count">{bunch.valid_count} / {bunch.target_count}</span><span className={`cycle-state ${bunch.progress_state}`}>{bunch.progress_state === "complete" ? "완성" : "진행 중"}</span>
                      </button>
                    </li>)}
                  </ol>}
                  {bunchCursors[selectedBoardId] && <button className="text-button history-more" type="button" onClick={() => void loadMoreBunches(selectedBoardId)}>회차 더 보기</button>}
                  <div className="privacy-note"><i aria-hidden="true">⌑</i><p>{selectedBoard?.kind === "shared" ? "개인 기록은 이 화면에 표시되지 않아요. 공유판에 받은 기록만 보여요." : "개인 기록은 나에게만 보여요. 공유판과 개수를 합치지 않아요."}</p></div>
                </aside>
              </div>
            </>
          ) : loadingGoals ? (
            <div className="loading-panel" role="status"><span className="loading-orbit" aria-hidden="true" /><p>차곡찬을 준비하고 있어요.</p></div>
          ) : goalListError ? (
            <section className="welcome-panel"><span className="welcome-mark" aria-hidden="true">✳</span><h2>목표를 불러오지 못했어요</h2><p>{goalListError}</p><button className="button button-primary" type="button" onClick={() => void loadGoals()}>다시 시도</button></section>
          ) : (
            <section className="welcome-panel"><span className="welcome-mark" aria-hidden="true">✳</span><p className="eyebrow">SMALL THINGS COUNT</p><h2>작은 수고도<br />차곡차곡.</h2><p>오늘의 나를 알아보고, 작은 칭찬을 쌓아 보세요.</p><button className="button button-primary" type="button" onClick={() => setShowCreate(true)}>첫 목표 만들기</button></section>
          )}
        </section>
      </div>
    </main>
  );
}
