"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { classifyMutationOutcome, createIdempotentRequest } from "@/client/idempotent-request.mjs";

type GoalStatus = "active" | "completed" | "archived";
type Bunch = { id: string; cycle_no: number; target_count: number; valid_count: number; progress_state: "incomplete" | "complete"; completed_at: string | null };
type GoalSummary = { id: string; title: string; private_description: string | null; status: GoalStatus; revision: number; created_at: string; completed_at: string | null; archived_at: string | null };
type Board = { viewer_role: "owner"; id: string; goal_id: string; kind: "personal" | "shared"; revision: number; next_target_count: number; shared_title: string | null; shared_description: string | null; current_bunch: Bunch | null };
type GoalDetail = { goal: GoalSummary; boards: Board[] };
type Praise = { viewer_role: "owner" | "contributor"; id: string; bunch_id: string; source: "self" | "peer"; actor: { user_id: string; nickname: string | null; avatar_key: string | null } | null; actor_label: string; message: string | null; occurred_on: string | null; recorded_at: string; cancelled_at: string | null; hidden_at: string | null; excluded_at: string | null; author_erased_at: string | null };
type Page<T> = { items: T[]; next_cursor: string | null };
type IdempotentAttempt = { key: string; body: Record<string, unknown> };

class ApiFailure extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

async function mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, idempotencyKey?: string) {
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
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [goalDetails, setGoalDetails] = useState<Record<string, GoalDetail>>({});
  const [goalCursor, setGoalCursor] = useState<string | null>(null);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [goalListError, setGoalListError] = useState("");
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

  const loadGoals = useCallback(async (cursor: string | null = null, append = false) => {
    if (append) setGoalListError("");
    else { setLoadingGoals(true); setGoalListError(""); }
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
    <main className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="차곡찬 홈">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">차곡찬</span>
        </a>
        <p className="topbar-note">나를 알아보는 작은 기록</p>
        <span className="profile-chip">오늘도 나</span>
      </header>

      <div className="workspace">
        <aside className={`goal-sidebar ${selectedGoalId ? "has-selection" : ""}`} aria-label="내 목표">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">MY GOALS</p>
              <h1>내 목표</h1>
            </div>
            <button className="icon-button add-button" type="button" aria-label="새 목표 만들기" onClick={() => { setShowCreate(true); setGoalFormError(""); setGoalAttempt(null); }}>
              <span aria-hidden="true">＋</span>
            </button>
          </div>

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
          <nav className="goal-list" aria-label="목표 목록">
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
        </aside>

        <section className="main-panel" aria-label="목표와 기록">
          {notice && <p className="notice-banner" role="status">{notice}<button type="button" aria-label="알림 닫기" onClick={() => setNotice("")}>닫기</button></p>}

          {showCreate ? (
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
