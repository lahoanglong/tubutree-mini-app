/** Xáo Fisher–Yates trên bản sao; `rng` trả [0, 1). */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Số ngày kể từ 1970-01-01 của ngày VN 'YYYY-MM-DD', để xoay vòng theo ngày cho mọi người như nhau. */
export function dayNumber(dayKey: string): number {
  return Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);
}
