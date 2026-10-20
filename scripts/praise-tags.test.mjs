import assert from "node:assert/strict";
import test from "node:test";
import { consumeTagInput, normalizePraiseTags, validTagName } from "../src/shared/praise-tags.mjs";

test("space moves a completed user value above the input without rewriting its name", () => {
  const first = consumeTagInput([], "#꾸준 ");
  assert.deepEqual(first.tags, ["꾸준"]); assert.equal(first.input, "");
  assert.deepEqual(consumeTagInput(first.tags, "#용기 ").tags, ["꾸준", "용기"]);
  assert.deepEqual(consumeTagInput([], "#꾸준").tags, []);
});
test("paste separates completed tokens and preserves the unfinished last token", () => {
  const result = consumeTagInput([], "#꾸준 #용기");
  assert.deepEqual(result.tags, ["꾸준"]); assert.equal(result.input, "#용기");
  assert.deepEqual(consumeTagInput(result.tags, result.input, true).tags, ["꾸준", "용기"]);
});
test("tabs, newlines, full-width and repeated spaces separate tags", () => {
  assert.deepEqual(consumeTagInput([], "  #꾸준\t#용기\n#배려　 ").tags, ["꾸준", "용기", "배려"]);
  assert.equal(consumeTagInput([], "  \t\n", true).input, "");
});
test("invalid tokens preserve the remaining original text and block save", () => {
  const result = consumeTagInput([], "#꾸준 용기 #배려 ", true);
  assert.deepEqual(result.tags, ["꾸준"]); assert.equal(result.input, "용기 #배려 "); assert.ok(result.error);
  for (const value of ["#", "# ", "##용기 ", "#좋아, ", "#🙂 ", "#_ ", "#\u200b "]) assert.ok(consumeTagInput([], value, true).error);
});
test("duplicates preserve first spelling and do not consume a slot", () => {
  assert.deepEqual(consumeTagInput([], "#Work #work #WORK ").tags, ["Work"]);
  assert.deepEqual(normalizePraiseTags(["e\u0301", "é", "Work", "work"]), ["é", "Work"]);
  assert.deepEqual(consumeTagInput(["a", "b", "c", "d", "e"], "#A ").tags, ["a", "b", "c", "d", "e"]);
});
test("count and codepoint length limits preserve excess draft instead of truncating", () => {
  const full = ["a", "b", "c", "d", "e"];
  const result = consumeTagInput(full, "#f #g ");
  assert.deepEqual(result.tags, full); assert.equal(result.input, "#f #g "); assert.ok(result.error);
  assert.ok(validTagName("가".repeat(20))); assert.equal(validTagName("가".repeat(21)), false);
  assert.equal(normalizePraiseTags([...full, "f"]), null);
});
test("normalization permits Unicode letters, marks and numbers but no hidden separators or markup", () => {
  for (const name of ["꾸준", "용기", "漢字", "العربية", "कर्म", "e\u0301", "𐐀", "새_출발-2"]) assert.ok(validTagName(name), name);
  for (const value of [null, 1, [], "", " ", "a b", "#용기", "<script>", "a\u0000", "a\u200b", "a\ufeff", "\u0301"]) assert.equal(validTagName(value), false);
  for (const value of [null, {}, "용기", [null], [["용기"]], ["#용기"]]) assert.equal(normalizePraiseTags(value), null);
});
test("flush returns the exact final list for the first save request", () => {
  const result = consumeTagInput(["꾸준"], "#용기", true);
  const request = { tags: result.tags };
  assert.deepEqual(request, { tags: ["꾸준", "용기"] }); assert.equal(result.error, "");
});
