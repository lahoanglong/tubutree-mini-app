export interface WasteRateSnapshot {
  unitsPerPoint: number;
  pointsPerGroup: number;
  dropsPerUnit: number;
  gramsPerUnit: number | null;
}

export function linePoints(qty: number, s: WasteRateSnapshot): number {
  return Math.floor(qty / s.unitsPerPoint) * s.pointsPerGroup;
}

export function lineDrops(qty: number, s: WasteRateSnapshot): number {
  return qty * s.dropsPerUnit;
}

export function unitsToNextPoint(qty: number, s: WasteRateSnapshot): number {
  return s.unitsPerPoint - (qty % s.unitsPerPoint);
}

export function requestTotals(lines: ReadonlyArray<{ qty: number; snap: WasteRateSnapshot }>): { points: number; drops: number; grams: number | null } {
  let points = 0;
  let drops = 0;
  let grams: number | null = 0;
  for (const { qty, snap } of lines) {
    points += linePoints(qty, snap);
    drops += lineDrops(qty, snap);
    grams = grams === null || snap.gramsPerUnit === null ? null : grams + qty * snap.gramsPerUnit;
  }
  return { points, drops, grams };
}
