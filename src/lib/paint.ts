/**
 * Decode PrusaSlicer/Bambu TriangleSelector paint data to the dominant state of a triangle.
 * The hex string is read back to front, bits LSB first. Each node: 2 bits split count;
 * leaf: 2 bits state (3 = extended, +4 bits); split node: 2 bits special side, then split+1 children.
 */
export function paintState(hex: string): number {
  const bits: number[] = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const n = parseInt(hex[i], 16);
    if (Number.isNaN(n)) return 0;
    bits.push(n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1);
  }
  let pos = 0;
  const read = (n: number) => { let v = 0; for (let b = 0; b < n; b++) v |= (bits[pos++] ?? 0) << b; return v; };
  const weight = new Map<number, number>();
  const walk = (w: number, depth: number) => {
    if (depth > 24 || pos >= bits.length) return;
    const split = read(2);
    if (split === 0) {
      let st = read(2);
      if (st === 3) st = read(4) + 3;
      weight.set(st, (weight.get(st) ?? 0) + w);
      return;
    }
    read(2); // special side
    const kids = split + 1;
    for (let c = 0; c < kids; c++) walk(w / kids, depth + 1);
  };
  walk(1, 0);
  let best = 0, bestW = 0, painted = 0;
  for (const [st, w] of weight) if (st) { painted += w; if (w > bestW) { best = st; bestW = w; } }
  // keep thin painted strokes visible: a triangle counts as painted from 25 % coverage
  return painted >= 0.25 ? best : 0;
}
