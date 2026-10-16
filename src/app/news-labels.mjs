/** @param {string} type */
export function notificationLabel(type) {
  switch (type) {
    case "praise_received": return "새 칭찬을 받았어요";
    case "bunch_completed": return "포도 한 송이를 다 채웠어요";
    case "connection_requested": return "연결 요청이 왔어요";
    case "connection_accepted": return "연결이 수락됐어요";
    default: return "새 소식이 있어요";
  }
}

/** @param {string} type */
export function canOpenConnections(type) {
  return type === "connection_requested" || type === "connection_accepted";
}
