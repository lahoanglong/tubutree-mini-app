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

/** Hình tròn bằng hai cung. */
function disc(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)} a${r} ${r} 0 1 0 ${n(2 * r)} 0 a${r} ${r} 0 1 0 ${n(-2 * r)} 0 Z`;
}

/** Con dấu thực vật học mảnh bao quanh huy hiệu: vòng mảnh ngoài và cung vòm mảnh bên trong theo phong cách dược thảo hữu cơ. */
function sealRing(): BadgeShape[] {
  return [
    { d: disc(24, 24, 20.5), fill: 'wash', line: { tone: 'light', w: 1 } },
    { d: 'M9.5 19 A15.5 15.5 0 0 1 38.5 19', fill: 'none', line: { tone: 'light', w: 0.9 } },
  ];
}

export const BRAND_BADGES: Record<string, BadgeShape[]> = {
  // Fuwa3e (Thanh Hóa): tán lá dứa vươn mảnh, quả dứa khắc gân chéo tinh tế và chùm bồ hòn hữu cơ.
  fuwa3e: [
    ...sealRing(),
    { d: 'M24 7 C22 11 22 15 24 18 C26 15 26 11 24 7 Z', fill: 'deep' },
    { d: 'M22.5 18 C18.5 15 15.5 11.5 14.5 8 C18.5 9.5 21 13 22.5 18 Z', fill: 'base' },
    { d: 'M25.5 18 C29.5 15 32.5 11.5 33.5 8 C29.5 9.5 27 13 25.5 18 Z', fill: 'base' },
    { d: 'M24 17.5 C30 17.5 33 23 33 29 C33 35.5 29 40 24 40 C19 40 15 35.5 15 29 C15 23 18 17.5 24 17.5 Z', fill: 'light', line: { tone: 'deep', w: 1.35 } },
    { d: 'M17.5 24 L29.5 36 M16.5 29.5 L25 38 M21.5 19.5 L31.5 29.5 M30.5 24 L18.5 36 M31.5 29.5 L23 38 M26.5 19.5 L16.5 29.5', fill: 'none', line: { tone: 'deep', w: 1.05 } },
    { d: disc(35.5, 34.5, 4.2), fill: 'base', line: { tone: 'deep', w: 1.25 } },
    { d: disc(34.2, 33.2, 1.1), fill: 'wash' },
  ],
  // BH.Nong (Quảng Nam): nhành trà rừng Trường Sơn đối xứng gân mảnh và giọt mật ong rừng nguyên bản.
  bhnong: [
    ...sealRing(),
    { d: 'M12 37 C17 31 23 23 31 12', fill: 'none', line: { tone: 'deep', w: 1.5 } },
    { d: 'M20 26 C14 25 11 19 14 13 C20 14 22 20 20 26 Z', fill: 'light', line: { tone: 'deep', w: 1.25 } },
    { d: 'M15 15 C17 18.5 18.5 22 19.5 25', fill: 'none', line: { tone: 'deep', w: 0.95 } },
    { d: 'M25 20 C25 14 30 10 36 11 C35 17 31 21 25 20 Z', fill: 'light', line: { tone: 'deep', w: 1.25 } },
    { d: 'M26 19.5 C29.5 17 32.5 14.5 34.5 12', fill: 'none', line: { tone: 'deep', w: 0.95 } },
    { d: 'M33 24 C36.5 29 38 32.5 38 35 A5 5 0 0 1 28 35 C28 32.5 29.5 29 33 24 Z', fill: 'base', line: { tone: 'deep', w: 1.3 } },
    { d: 'M31 34 C31 36 32.2 37.2 33.5 37.5', fill: 'none', line: { tone: 'wash', w: 1.2 } },
  ],
  // Pơ Lang (Đắk Lắk): trái ca cao bazan bổ dọc lộ múi hạt và chiếc lá gân mảnh.
  polang: [
    ...sealRing(),
    { d: 'M22 8 C28.5 10 32.5 17 32.5 25.5 C32.5 34 28.5 40 22 41.5 C15.5 40 11.5 34 11.5 25.5 C11.5 17 15.5 10 22 8 Z', fill: 'base', line: { tone: 'deep', w: 1.4 } },
    { d: 'M22 11.5 C26.2 13.5 28.8 18.8 28.8 25.5 C28.8 32.2 26.2 37 22 38.5 C17.8 37 15.2 32.2 15.2 25.5 C15.2 18.8 17.8 13.5 22 11.5 Z', fill: 'wash', line: { tone: 'deep', w: 1.05 } },
    { d: 'M22 13 L22 37 M18.5 19.5 L25.5 19.5 M18 25.5 L26 25.5 M18.5 31.5 L25.5 31.5', fill: 'none', line: { tone: 'deep', w: 1.1 } },
    { d: 'M31 19 C36 16 40 18 40 23.5 C35.5 26 31.5 24 31 19 Z', fill: 'light', line: { tone: 'deep', w: 1.2 } },
    { d: disc(35.5, 34, 3), fill: 'deep' },
  ],
  // Visante (Khánh Hòa): nhánh tảo biển Nha Trang mềm mại, tinh thể muối khoáng và đường thuỷ triều.
  visante: [
    ...sealRing(),
    { d: 'M17 37 C14 31 20 26 17 19 C15 14.5 18 11 17.5 8.5', fill: 'none', line: { tone: 'deep', w: 1.7 } },
    { d: 'M17 28 C13.5 26 12.5 23 14 20.5 M17.5 21 C20.5 19 21.5 16 20 13.5', fill: 'none', line: { tone: 'base', w: 1.3 } },
    { d: 'M26 37 C23.5 30 28.5 25 25.5 17 C24 13 26.5 10 26 7.5', fill: 'none', line: { tone: 'base', w: 1.6 } },
    { d: 'M34.5 15 L38.5 19 L34.5 23 L30.5 19 Z', fill: 'light', line: { tone: 'deep', w: 1.25 } },
    { d: 'M10 36 C14.5 33.5 19 38.5 24 36 C29 33.5 33.5 38.5 38 36', fill: 'none', line: { tone: 'deep', w: 1.4 } },
    { d: 'M12.5 40 C16.5 38 20.5 41.5 24 39.5 C27.5 38 31.5 41.5 35.5 39.5', fill: 'none', line: { tone: 'light', w: 1.2 } },
  ],
  // Hector (Lâm Đồng): ba sợi đông trùng hạ thảo thanh mảnh vươn trên đường vân sương cao nguyên.
  hector: [
    ...sealRing(),
    { d: 'M10 37 C16 33.5 32 33.5 38 37', fill: 'none', line: { tone: 'deep', w: 1.35 } },
    { d: 'M13 39.5 C19 37 29 37 35 39.5', fill: 'none', line: { tone: 'light', w: 1.15 } },
    { d: 'M16.5 35.5 C15.5 29.5 17 24.5 16 19.5', fill: 'none', line: { tone: 'base', w: 1.6 } },
    { d: 'M24 35 C23.5 27.5 25.5 21 24 13.5', fill: 'none', line: { tone: 'deep', w: 1.75 } },
    { d: 'M31.5 35.5 C32.5 30 31 25.5 32 21', fill: 'none', line: { tone: 'base', w: 1.6 } },
    { d: 'M16 20 C13.8 17.5 14 11.5 16 10.5 C18 11.5 18.2 17.5 16 20 Z', fill: 'base', line: { tone: 'deep', w: 1.15 } },
    { d: 'M24 14.5 C21.5 11.5 21.8 5.5 24 4.5 C26.2 5.5 26.5 11.5 24 14.5 Z', fill: 'deep' },
    { d: 'M32 21.5 C30 19.2 30.2 14 32 13 C33.8 14 34 19.2 32 21.5 Z', fill: 'light', line: { tone: 'deep', w: 1.15 } },
  ],
  // Le Plateau (Cầu Đất): nhành cà phê Arabica cao nguyên lá gân mảnh và chùm quả chín mọng.
  leplateau: [
    ...sealRing(),
    { d: 'M11 37 C17 31 27 22 37 11', fill: 'none', line: { tone: 'deep', w: 1.65 } },
    { d: 'M21 27 C15.5 22 18 14 25.5 12 C28.5 18.5 26.5 24.5 21 27 Z', fill: 'light', line: { tone: 'deep', w: 1.25 } },
    { d: 'M21.5 25.5 C22.5 21.5 23.8 17.5 25 14', fill: 'none', line: { tone: 'deep', w: 0.95 } },
    { d: 'M28 21 C29.5 14.5 35 10.5 40.5 11.5 C39.5 18 34.5 21.5 28 21 Z', fill: 'wash', line: { tone: 'deep', w: 1.25 } },
    { d: disc(16.5, 32, 3.6), fill: 'base', line: { tone: 'deep', w: 1.2 } },
    { d: disc(23, 35.5, 3.4), fill: 'deep' },
    { d: disc(15.5, 30.8, 1), fill: 'wash' },
  ],
  // Cobote (Bến Tre): tàu dừa cong thanh nhã, gáo dừa hữu cơ cắt ngang và giọt dầu dừa ép lạnh.
  cobote: [
    ...sealRing(),
    { d: 'M12 19 C17 11 27 9 36 14', fill: 'none', line: { tone: 'deep', w: 1.5 } },
    { d: 'M16 15 L13 11 M21 12.5 L19.5 8 M26.5 11.8 L27 7.5 M31.5 12.8 L34 9', fill: 'none', line: { tone: 'base', w: 1.15 } },
    { d: 'M12 26 A11 11 0 0 0 34 26 Z', fill: 'base', line: { tone: 'deep', w: 1.4 } },
    { d: 'M15 26 A8 8 0 0 0 31 26 Z', fill: 'wash', line: { tone: 'deep', w: 1.05 } },
    { d: 'M36 27 C38.5 31 39.5 33.5 39.5 35.5 A3.5 3.5 0 0 1 32.5 35.5 C32.5 33.5 33.5 31 36 27 Z', fill: 'light', line: { tone: 'deep', w: 1.2 } },
  ],
  // Sokfarm (Trà Vinh): mo hoa dừa uốn cong thanh mảnh, chuỗi nụ hoa và giọt mật hoa dừa thu thủ công.
  sokfram: [
    ...sealRing(),
    { d: 'M12 37 C13 25 20 15 33 10', fill: 'none', line: { tone: 'deep', w: 1.7 } },
    { d: 'M15 29 C19 20 26 15 35 15', fill: 'none', line: { tone: 'base', w: 1.3 } },
    { d: 'M14 33 C20 27 27 23 35 22', fill: 'none', line: { tone: 'light', w: 1.2 } },
    { d: disc(21, 20, 2.2), fill: 'base', line: { tone: 'deep', w: 1 } },
    { d: disc(26.5, 16, 2.2), fill: 'light', line: { tone: 'deep', w: 1 } },
    { d: disc(32, 13.5, 2.1), fill: 'base', line: { tone: 'deep', w: 1 } },
    { d: 'M32.5 26.5 C35.5 31 36.8 33.8 36.8 36 A4.3 4.3 0 0 1 28.2 36 C28.2 33.8 29.5 31 32.5 26.5 Z', fill: 'deep' },
    { d: disc(31.2, 35.2, 1.1), fill: 'wash' },
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
