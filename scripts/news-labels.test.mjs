import assert from "node:assert/strict";
import test from "node:test";
import { canOpenConnections, notificationLabel } from "../src/app/news-labels.mjs";

for (const [type, label, opensConnections] of [
  ["praise_received", "새 칭찬을 받았어요", false],
  ["bunch_completed", "포도 한 송이를 다 채웠어요", false],
  ["connection_requested", "연결 요청이 왔어요", true],
  ["connection_accepted", "연결이 수락됐어요", true],
  ["unknown_type", "새 소식이 있어요", false],
]) {
  test(`${type}의 한국어 문구와 연결 이동 여부`, () => {
    assert.equal(notificationLabel(type), label);
    assert.equal(canOpenConnections(type), opensConnections);
  });
}

test("미지 타입과 객체 속성 이름으로 연결 이동을 추측하지 않는다", () => {
  for (const type of ["", "connection", "connection_rejected", "constructor", "toString", "__proto__"]) {
    assert.equal(notificationLabel(type), "새 소식이 있어요");
    assert.equal(canOpenConnections(type), false);
  }
});
