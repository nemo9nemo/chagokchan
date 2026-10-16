/** A centered, sequential cluster. Geometry uses the available container width. */
export function grapeLayout(target, containerWidth = 400) {
  if (!Number.isInteger(target) || target < 1 || target > 100) throw new RangeError("target must be 1..100");
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) throw new RangeError("width must be positive");
  const k = Math.ceil((Math.sqrt(8 * target + 1) - 1) / 2);
  const diameter = Math.min(56, containerWidth / (k * 1.1));
  const width = k * diameter * 1.1;
  const rows = [];
  const units = [];
  let remaining = target;
  for (let capacity = k; remaining > 0; capacity--) {
    const count = Math.min(capacity, remaining);
    const row = rows.length;
    rows.push(count);
    for (let column = 0; column < count; column++) {
      units.push({ index: units.length, row, column,
        x: (width - count * diameter * 1.1) / 2 + column * diameter * 1.1 + diameter * 0.05,
        y: diameter * 1.15 + row * diameter * 0.92 });
    }
    remaining -= count;
  }
  return { rows, units, diameter, width, height: diameter * (2.3 + (rows.length - 1) * 0.92) };
}
