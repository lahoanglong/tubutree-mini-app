/**
 * Hình vẽ Noel Xanh dùng chung cho Mini App và web: cây thông trong chậu (viewBox 96 × 120), hộp quà (40 × 40), bông tuyết và lá thông rơi.
 * Chỉ là số liệu: app vẽ bằng `<svg>` với lớp `.tubu-xmas-*` (màu trong seasonal-christmas.css của design-tokens), nên hai app ra cùng hình.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

export const TREE_VIEWBOX = '0 0 96 120';
const CX = 48;

interface Tier {
  top: number;
  bottom: number;
  half: number;
  tips: number;
}

const TIERS: readonly Tier[] = [
  { top: 14, bottom: 42, half: 17, tips: 3 },
  { top: 30, bottom: 68, half: 29, tips: 4 },
  { top: 52, bottom: 96, half: 41, tips: 5 },
];

/** Một tầng lá: đỉnh, mép phải, các chóp cành rủ xuống ở đáy (cong lồi xuống), mép trái. */
function tierPath(t: Tier): string {
  const left = CX - t.half;
  const step = (t.half * 2) / t.tips;
  let d = `M${CX} ${t.top} L${CX + t.half} ${t.bottom}`;
  for (let i = 0; i < t.tips; i++) {
    const x0 = CX + t.half - i * step;
    d += ` Q${r1(x0 - step / 2)} ${t.bottom + 5} ${r1(x0 - step)} ${t.bottom}`;
  }
  return `${d} L${left} ${t.bottom} Z`;
}

/** Tuyết đọng dọc đáy mỗi tầng (nét kem, cùng đường chóp cành nhưng nhích lên). */
function snowPath(t: Tier): string {
  const step = (t.half * 2) / t.tips;
  let d = `M${r1(CX + t.half - 2)} ${t.bottom - 2}`;
  for (let i = 0; i < t.tips; i++) {
    const x0 = CX + t.half - i * step;
    const x1 = i === t.tips - 1 ? CX - t.half + 2 : x0 - step;
    d += ` Q${r1(x0 - step / 2)} ${t.bottom + 2} ${r1(x1)} ${t.bottom - 2}`;
  }
  return d;
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
}

export const TREE_ART = {
  tiers: TIERS.map(tierPath),
  snow: TIERS.map(snowPath),
  star: starPath(CX, 9, 7, 3),
  trunk: 'M44 94 H52 V103 H44 Z',
  potRim: 'M34 100 H62 V105 H34 Z',
  pot: 'M37 105 H59 L56 118 H40 Z',
  /** Lá trên chậu: dấu Tubu Tree. */
  leaf: 'M48 116 C44 112 44 108 48 107 C52 108 52 112 48 116 Z',
  /** Quả châu đỏ quả tầm xuân. */
  berries: [
    [40, 36],
    [58, 58],
    [36, 62],
    [53, 80],
    [69, 86],
    [27, 88],
  ] as const,
  /** Đèn vàng nhấp nháy lệch nhịp (`--i` = thứ tự). */
  lights: [
    [52, 26],
    [44, 48],
    [62, 46],
    [30, 74],
    [48, 66],
    [64, 72],
    [40, 88],
    [58, 92],
  ] as const,
} as const;

export const GIFT_VIEWBOX = '0 0 40 40';
export const GIFT_ART = {
  body: 'M8 18 H32 V36 Q32 38 30 38 H10 Q8 38 8 36 Z',
  ribbonBody: 'M18 18 H22 V38 H18 Z',
  lid: 'M5 12 H35 Q36 12 36 13 V18 H4 V13 Q4 12 5 12 Z',
  ribbonLid: 'M18 12 H22 V18 H18 Z',
  bow: 'M20 12 C13 2 7 9 20 12 Z M20 12 C27 2 33 9 20 12 Z',
} as const;

/** Biểu tượng nét 16 × 16 (vẽ bằng stroke, lớp `.tubu-xmas-icon`): dấu đã nhận, ổ khoá, bông tuyết của nút ❄️. */
export const ICON_VIEWBOX = '0 0 16 16';
export const XMAS_ICONS = {
  check: 'M3.5 8.5 L6.5 11.5 L12.5 4.5',
  lock: 'M4.5 7.5 H11.5 V13 H4.5 Z M6 7.5 V5.5 A2 2 0 0 1 10 5.5 V7.5',
  snowflake: 'M8 1.5 V14.5 M2.4 4.75 L13.6 11.25 M2.4 11.25 L13.6 4.75 M6.5 2.5 L8 4 L9.5 2.5 M6.5 13.5 L8 12 L9.5 13.5',
} as const;

export interface Flake {
  /** % chiều ngang khung. */
  x: number;
  /** Cỡ, đơn vị px (CSS nhân với 1px). */
  size: number;
  /** Giây một lượt rơi. */
  dur: number;
  /** Giây, âm: bông tuyết đã rơi dở khi trang mở, không đổ cùng lúc từ mép trên. */
  delay: number;
  /** Độ dạt ngang, px. */
  drift: number;
  opacity: number;
  /** Lá thông nhỏ thay cho bông tuyết. */
  needle: boolean;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFlakes(count: number, seed: number, o: { xMin: number; xMax: number; dur: [number, number]; delay: [number, number]; needleEvery: number }): Flake[] {
  const rand = rng(seed);
  const between = (a: number, b: number) => a + (b - a) * rand();
  return Array.from({ length: count }, (_, i) => ({
    x: r1(o.xMin + ((o.xMax - o.xMin) * (i + rand())) / count),
    size: r1(between(4, 9)),
    dur: r1(between(o.dur[0], o.dur[1])),
    delay: r1(between(o.delay[0], o.delay[1])),
    drift: r1(between(-24, 24)),
    opacity: r1(between(0.55, 0.95) * 100) / 100,
    needle: o.needleEvery > 0 && i % o.needleEvery === o.needleEvery - 1,
  }));
}

/** Lớp tuyết toàn màn: 20 bông (trong khoảng 18–24 PO duyệt), mỗi bông thứ 5 là một lá thông nhỏ. */
export const SNOWFLAKES: readonly Flake[] = makeFlakes(20, 1225, { xMin: 0, xMax: 100, dur: [9, 17], delay: [-17, 0], needleEvery: 5 });

/** Đợt tuyết rơi quanh cây khi rung: rơi trong khung thẻ, một lượt rồi tắt. */
export const BURST_FLAKES: readonly Flake[] = makeFlakes(10, 1224, { xMin: 4, xMax: 40, dur: [1.2, 2], delay: [0, 0.4], needleEvery: 4 });
