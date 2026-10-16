import assert from "node:assert/strict";
import test from "node:test";
import { grapeLayout } from "../src/app/grape-layout.mjs";

for (const [target, rows] of [[1, [1]], [15, [5, 4, 3, 2, 1]], [20, [6, 5, 4, 3, 2]], [100, [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 1]]]) {
  test(`${target} sequential grapes have the expected centered rows`, () => {
    const layout = grapeLayout(target, 280);
    assert.deepEqual(layout.rows, rows);
    assert.equal(layout.units.length, target);
    assert.deepEqual(layout.units.map((unit) => unit.index), Array.from({ length: target }, (_, index) => index));
    for (const row of rows.keys()) {
      const units = layout.units.filter((unit) => unit.row === row);
      assert.ok(Math.abs(units[0].x + units.at(-1).x + layout.diameter - layout.width) < 1e-9);
    }
  });
}

test("every target fits narrow and wide containers with capped diameter", () => {
  for (let target = 1; target <= 100; target++) {
    for (const width of [160, 240, 280, 320, 360, 393, 768, 1280]) {
      const layout = grapeLayout(target, width);
      assert.ok(layout.width <= width + 1e-9);
      assert.ok(layout.diameter <= 56);
      assert.equal(layout.units.length, target);
      for (const unit of layout.units) {
        assert.ok(unit.x >= 0 && unit.y >= 0);
        assert.ok(unit.x + layout.diameter <= layout.width + 1e-9);
        assert.ok(unit.y + layout.diameter <= layout.height + 1e-9);
      }
    }
  }
});

test("invalid targets and widths are rejected", () => {
  for (const target of [0, 101, 1.5, NaN]) assert.throws(() => grapeLayout(target), RangeError);
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => grapeLayout(20, width), RangeError);
});
