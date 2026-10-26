// A fresh authorized detail is required on each open. Current-board rendering
// and praise loading do not wait for unrelated/past-cycle history requests.
export async function openBoardView({ goalId, preferredBoardId, preferredBunchId,
  getDetail, getHistory, getPraises, onReady, onHistory, onHistoryError, isCurrent }) {
  const detail = await getDetail(goalId);
  if (!isCurrent()) return;
  const board = detail.boards.find(item => item.id === preferredBoardId)
    ?? detail.boards.find(item => item.kind === "personal") ?? detail.boards[0];
  const readHistory = async (item) => {
    const page = await getHistory(item.id);
    while (item.id === preferredBoardId && preferredBunchId && page.next_cursor && !page.items.some(bunch => bunch.id === preferredBunchId)) {
      if (!isCurrent()) return page;
      const older = await getHistory(item.id, page.next_cursor);
      page.items.push(...older.items);
      page.next_cursor = older.next_cursor;
    }
    return page;
  };
  let selectedHistory;
  let bunch = board.current_bunch;
  if (preferredBunchId && preferredBunchId !== bunch?.id) {
    selectedHistory = await readHistory(board);
    if (!isCurrent()) return;
    bunch = selectedHistory.items.find(item => item.id === preferredBunchId) ?? bunch ?? selectedHistory.items[0] ?? null;
  }
  onReady(detail, board, bunch);
  if (selectedHistory) onHistory(board.id, selectedHistory);
  const praises = getPraises(board.id, bunch?.id ?? "");
  for (const item of detail.boards) {
    if (item.id === board.id && selectedHistory) continue;
    void readHistory(item).then(page => {
      if (isCurrent()) onHistory(item.id, page);
    }, error => {
      if (isCurrent()) onHistoryError(error);
    });
  }
  const page = await praises;
  return isCurrent() ? { bunch, page } : undefined;
}
