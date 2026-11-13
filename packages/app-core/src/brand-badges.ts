/**
 * Huy hiệu minh hoạ riêng cho từng nhãn ở "Hành trình nguyên liệu": mỗi nhãn một bộ hình vector trong khung 48 x 48, dùng chung cho Mini App và
 * web (hai app chỉ vẽ `<svg aria-hidden>` từ dữ liệu này). Màu chỉ pha từ token nhận diện `--color-brand-<id>` với nền thẻ và chữ, nên đổi màu nhãn
 * hay chế độ tối thì huy hiệu đổi theo; không có hex.
 */
export type BadgeTone = 'wash' | 'light' | 'base' | 'deep';

export interface BadgeShape {
  /** Đường vẽ trong khung 48 x 48. */
  d: string;
  /** Màu tô; `none` thì chỉ vẽ nét. */
  fill: BadgeTone | 'none';
  /** Nét viền (bề rộng trong khung 48, đầu nét và góc tròn). */
  line?: { tone: BadgeTone; w: number };
}

export const BADGE_VIEWBOX = '0 0 48 48';

const MIX: Record<Exclude<BadgeTone, 'base'>, string> = {
  wash: 'color-mix(in srgb, var(--color-brand-ID) 16%, var(--color-bg-surface))',
  light: 'color-mix(in srgb, var(--color-brand-ID) 42%, var(--color-bg-surface))',
  deep: 'color-mix(in srgb, var(--color-brand-ID) 66%, var(--color-text-primary))',
};

/** Màu của một tông trên huy hiệu nhãn `id`. */
export function badgeColor(id: string, tone: BadgeTone): string {
  return tone === 'base' ? `var(--color-brand-${id})` : MIX[tone].replace('ID', id);
}

/** Nền nhạt của ô huy hiệu. */
export function badgeBackground(id: string): string {
  return `color-mix(in srgb, var(--color-brand-${id}) 12%, var(--color-bg-surface))`;
}

const n = (v: number) => Math.round(v * 100) / 100;

/** Lục giác đỉnh nhọn lên trên, tâm (cx, cy), bán kính r. */
function hex(cx: number, cy: number, r: number): string {
  const w = (Math.sqrt(3) / 2) * r;
  const pts = [
    [cx, cy - r],
    [cx + w, cy - r / 2],
    [cx + w, cy + r / 2],
    [cx, cy + r],
    [cx - w, cy + r / 2],
    [cx - w, cy - r / 2],
  ];
  return `M${pts.map(([x, y]) => `${n(x!)} ${n(y!)}`).join(' L')} Z`;
}

/** Hình tròn bằng hai cung. */
function disc(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)} a${r} ${r} 0 1 0 ${n(2 * r)} 0 a${r} ${r} 0 1 0 ${n(-2 * r)} 0 Z`;
}

export const BRAND_BADGES: Record<string, BadgeShape[]> = {
  // Dứa (thân, vảy, tán lá) và quả bồ hòn.
  fuwa3e: [
    { d: 'M24 6 C21 11 21 14 24 18 C27 14 27 11 24 6 Z', fill: 'deep' },
    { d: 'M22 18 C17 15 14 11 13 6 C18 8 21 12 22 18 Z', fill: 'deep' },
    { d: 'M26 18 C31 15 34 11 35 6 C30 8 27 12 26 18 Z', fill: 'deep' },
    { d: 'M24 17 C32 17 35 25 35 31 C35 39 30 44 24 44 C18 44 13 39 13 31 C13 25 16 17 24 17 Z', fill: 'base' },
    { d: 'M16 25 L30 39 M14 31 L24 42 M22 19 L33 30 M32 25 L18 39 M34 31 L25 42 M26 19 L15 30', fill: 'none', line: { tone: 'deep', w: 1.3 } },
    { d: disc(38, 36, 6), fill: 'light', line: { tone: 'deep', w: 1.6 } },
    { d: disc(36, 34, 1.6), fill: 'wash' },
  ],
  // Tổ ong sáu ô và một chiếc lá.
  bhnong: [
    { d: hex(18, 16, 5.6), fill: 'light' },
    { d: hex(29.3, 16, 5.6), fill: 'wash', line: { tone: 'light', w: 1.2 } },
    { d: hex(12.4, 25.8, 5.6), fill: 'wash', line: { tone: 'light', w: 1.2 } },
    { d: hex(23.6, 25.8, 5.6), fill: 'base' },
    { d: hex(34.9, 25.8, 5.6), fill: 'light' },
    { d: hex(18, 35.6, 5.6), fill: 'light' },
    { d: hex(29.3, 35.6, 5.6), fill: 'wash', line: { tone: 'light', w: 1.2 } },
    { d: 'M33 11 C40 10 44 15 43 22 C36 23 32 18 33 11 Z', fill: 'deep' },
    { d: 'M34 12 C37 16 40 19 42 21', fill: 'none', line: { tone: 'wash', w: 1.1 } },
  ],
  // Quả bơ: vỏ, thịt và hạt.
  polang: [
    { d: 'M24 4 C30 4 33 11 34 17 C38 21 40 26 40 31 C40 39 33 44 24 44 C15 44 8 39 8 31 C8 26 10 21 14 17 C15 11 18 4 24 4 Z', fill: 'deep' },
    { d: 'M24 8 C28 8 30 14 31 19 C35 22 36 27 36 31 C36 37 31 40 24 40 C17 40 12 37 12 31 C12 27 13 22 17 19 C18 14 20 8 24 8 Z', fill: 'light' },
    { d: disc(24, 31, 7), fill: 'base' },
    { d: disc(21.5, 28.5, 2), fill: 'wash' },
  ],
  // Sóng biển và rong biển.
  visante: [
    { d: 'M15 40 C10 32 19 28 15 20 C12 14 17 11 16 6', fill: 'none', line: { tone: 'deep', w: 2.6 } },
    { d: 'M25 40 C20 31 29 27 25 18 C22 12 27 9 26 5', fill: 'none', line: { tone: 'base', w: 2.6 } },
    { d: 'M35 40 C31 33 38 30 35 23 C33 18 37 16 36 12', fill: 'none', line: { tone: 'light', w: 2.6 } },
    { d: 'M5 34 q4.75 -5 9.5 0 t9.5 0 t9.5 0 t9.5 0 L43 44 L5 44 Z', fill: 'wash' },
    { d: 'M5 34 q4.75 -5 9.5 0 t9.5 0 t9.5 0 t9.5 0', fill: 'none', line: { tone: 'base', w: 2.4 } },
    { d: 'M5 41 q4.75 -5 9.5 0 t9.5 0 t9.5 0 t9.5 0', fill: 'none', line: { tone: 'light', w: 2.4 } },
  ],
  // Đông trùng hạ thảo: ba thể quả hình chày mọc từ nền đất.
  hector: [
    { d: 'M5 43 C10 35 38 35 43 43 Z', fill: 'light' },
    { d: 'M14 38 C13 31 15 26 14 20', fill: 'none', line: { tone: 'base', w: 2.2 } },
    { d: 'M24 37 C23 28 26 22 24 12', fill: 'none', line: { tone: 'base', w: 2.2 } },
    { d: 'M34 38 C35 32 33 27 34 23', fill: 'none', line: { tone: 'base', w: 2.2 } },
    { d: 'M14 21 C10.5 18 11 9 14 8 C17 9 17.5 18 14 21 Z', fill: 'deep' },
    { d: 'M24 13 C20 9.5 20.5 1 24 0 C27.5 1 28 9.5 24 13 Z', fill: 'deep' },
    { d: 'M34 24 C31 21.5 31.5 14.5 34 13.5 C36.5 14.5 37 21.5 34 24 Z', fill: 'deep' },
    { d: disc(8, 40, 1.4), fill: 'base' },
    { d: disc(40, 41, 1.4), fill: 'base' },
  ],
  // Cành cà phê: hai lá và chùm quả.
  leplateau: [
    { d: 'M7 41 C15 35 28 25 41 9', fill: 'none', line: { tone: 'deep', w: 2.4 } },
    { d: 'M20 31 C15 24 19 15 28 12 C32 20 28 28 20 31 Z', fill: 'light', line: { tone: 'deep', w: 1.4 } },
    { d: 'M30 20 C30 12 37 6 44 6 C44 14 38 20 30 20 Z', fill: 'light', line: { tone: 'deep', w: 1.4 } },
    { d: 'M21 28 C23 24 25 19 27 15', fill: 'none', line: { tone: 'deep', w: 1.1 } },
    { d: disc(13, 35, 4.4), fill: 'base' },
    { d: disc(21, 40, 4.4), fill: 'base' },
    { d: disc(10, 43, 3.4), fill: 'deep' },
    { d: disc(11.8, 33.2, 1.3), fill: 'wash' },
    { d: disc(19.8, 38.2, 1.3), fill: 'wash' },
  ],
  // Quả dừa: vỏ, ba mắt và tàu lá.
  cobote: [
    { d: 'M24 11 C19 5 12 4 7 8', fill: 'none', line: { tone: 'deep', w: 2.4 } },
    { d: 'M24 11 C29 5 36 4 41 8', fill: 'none', line: { tone: 'deep', w: 2.4 } },
    { d: 'M24 11 L24 5', fill: 'none', line: { tone: 'deep', w: 2.4 } },
    { d: disc(24, 28, 15), fill: 'base' },
    { d: 'M12 24 C13 17 18 13 24 13', fill: 'none', line: { tone: 'light', w: 2 } },
    { d: disc(19.5, 24, 2.1), fill: 'wash' },
    { d: disc(28.5, 24, 2.1), fill: 'wash' },
    { d: disc(24, 31, 2.1), fill: 'wash' },
  ],
  // Hoa dừa: cuống hoa cong, chùm nụ và giọt mật.
  sokfram: [
    { d: 'M6 30 C10 18 20 10 28 9', fill: 'none', line: { tone: 'light', w: 2 } },
    { d: 'M42 30 C38 20 32 14 27 10', fill: 'none', line: { tone: 'light', w: 2 } },
    { d: 'M13 43 C13 28 20 16 34 11', fill: 'none', line: { tone: 'deep', w: 2.6 } },
    { d: disc(18, 25, 3), fill: 'base' },
    { d: disc(22, 19.5, 3), fill: 'base' },
    { d: disc(27.5, 15.2, 3), fill: 'base' },
    { d: disc(33.5, 12, 3.2), fill: 'base' },
    { d: disc(15, 31, 2.5), fill: 'light' },
    { d: disc(26, 22, 2.5), fill: 'light' },
    { d: 'M36 28 C40 34 41 37 38.5 40.5 C36 43 32 41 32.5 37 C33 34 35 31 36 28 Z', fill: 'deep' },
    { d: disc(35, 37, 1.1), fill: 'wash' },
  ],
};

export interface DrawnBadgeShape {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/** Hình đã đổi sang màu CSS cho nhãn `id`, sẵn để vẽ `<path fill stroke strokeWidth>`; id không có huy hiệu thì mảng rỗng. */
export function drawBadge(id: string): DrawnBadgeShape[] {
  return (BRAND_BADGES[id] ?? []).map((s) => ({
    d: s.d,
    fill: s.fill === 'none' ? 'none' : badgeColor(id, s.fill),
    stroke: s.line ? badgeColor(id, s.line.tone) : 'none',
    strokeWidth: s.line?.w ?? 0,
  }));
}
