import { BRAND_ORIGINS, type BrandOrigin } from './brand-origins';

/**
 * Hình học và bố cục bản đồ chú thích ở "Hành trình nguyên liệu", dùng chung cho Mini App và web (hai app chỉ vẽ).
 *
 * Bản đồ là sơ đồ hoá (không theo tỉ lệ): các vùng vẽ bằng đa giác phẳng, tám tỉnh xuất xứ là chấm ghim không tương tác; tên nhãn nằm ở hai cột
 * hai bên và là điều khiển thật, nối với chấm bằng một đường dẫn. Mọi số của bố cục tính theo đơn vị khung (khung rộng 100) nên bản đồ nở theo
 * bề rộng mà không cần JavaScript đo; chỉ kích thước chữ và vùng chạm là px cố định, nên bố cục được tính cho bề rộng hẹp nhất
 * (`MAP_MIN_WIDTH`) và từ đó trở lên chỉ có thêm chỗ.
 */

/** Hệ toạ độ gốc của đa giác vùng và vị trí tỉnh (`BrandOrigin.geo`). */
export const MAP_GEO = { w: 450, h: 700 } as const;

/** Vùng hình học dùng khi dựng khung: toạ độ gốc đã cắt sát hình Việt Nam và hai quần đảo. */
const GEO_BOX = { x0: 55, x1: 350, y0: 20, y1: 650 } as const;

/** Khung bản đồ: rộng 100 đơn vị, cao `h` đơn vị (tỉ lệ cao/rộng = h / 100). */
export const MAP_FRAME = { w: 100, h: 122 } as const;

/** Dải chú giải ba đảo ở đáy khung (đơn vị khung): hai cột nhãn không được vào dải này. */
export const MAP_LEGEND_H = 12;

/** Đường kính chấm số đánh dấu đảo (px). */
export const ISLAND_PIN_PX = 16;

export const MAP_MIN_WIDTH = 288;
export const MAP_MAX_WIDTH = 560;

/** Hai cột nhãn: mỗi cột 27 đơn vị, cách mép khung 1 đơn vị. */
const COLUMN_W = 27;
const COLUMN_INSET = 1;
export const MAP_COLUMNS = {
  left: { x0: COLUMN_INSET, x1: COLUMN_INSET + COLUMN_W },
  right: { x0: MAP_FRAME.w - COLUMN_INSET - COLUMN_W, x1: MAP_FRAME.w - COLUMN_INSET },
} as const;

/** Vùng hình học nằm giữa hai cột. */
const ZONE = { x0: MAP_COLUMNS.left.x1, x1: MAP_COLUMNS.right.x0 } as const;
const SCALE = (ZONE.x1 - ZONE.x0) / (GEO_BOX.x1 - GEO_BOX.x0);
const OFFSET_Y = (MAP_FRAME.h - MAP_LEGEND_H - (GEO_BOX.y1 - GEO_BOX.y0) * SCALE) / 2;

/** Đổi toạ độ gốc sang đơn vị khung. */
export function geoToFrame(g: { x: number; y: number }): { x: number; y: number } {
  return { x: ZONE.x0 + (g.x - GEO_BOX.x0) * SCALE, y: OFFSET_Y + (g.y - GEO_BOX.y0) * SCALE };
}

/** Phép biến đổi SVG đưa toạ độ gốc vào khung; vẽ đa giác vùng trong `<g transform={MAP_GEO_TRANSFORM}>` với viewBox `0 0 MAP_FRAME.w MAP_FRAME.h`. */
export const MAP_GEO_TRANSFORM = `translate(${(ZONE.x0 - GEO_BOX.x0 * SCALE).toFixed(3)} ${(OFFSET_Y - GEO_BOX.y0 * SCALE).toFixed(3)}) scale(${SCALE.toFixed(5)})`;

export const MAP_VIEWBOX = `0 0 ${MAP_FRAME.w} ${MAP_FRAME.h}`;

type Point = readonly [number, number];

export interface MapRegion {
  id: string;
  points: readonly Point[];
  /** Vùng có nhãn nguyên liệu: tô đậm hơn để nhìn ra "vùng nguyên liệu". */
  origin: boolean;
}

/** 14 vùng sơ đồ từ Bắc vào Nam (tên chỉ để đọc mã, không vẽ chữ trong đa giác). */
export const MAP_REGIONS: readonly MapRegion[] = [
  { id: 'tay-bac', origin: false, points: [[125, 35], [75, 60], [95, 95], [138, 78]] },
  { id: 'dong-bac', origin: false, points: [[138, 78], [125, 35], [175, 35], [215, 55], [195, 92]] },
  { id: 'son-la', origin: false, points: [[95, 95], [138, 78], [160, 115], [120, 128]] },
  { id: 'ha-noi', origin: false, points: [[160, 115], [195, 92], [225, 110], [180, 142]] },
  { id: 'thanh-hoa', origin: true, points: [[120, 128], [180, 142], [165, 178], [125, 158]] },
  { id: 'nghe-an', origin: false, points: [[125, 158], [165, 178], [192, 195], [145, 215]] },
  { id: 'hue', origin: false, points: [[145, 215], [192, 195], [215, 240], [175, 252]] },
  { id: 'quang-nam', origin: true, points: [[175, 252], [215, 240], [255, 275], [208, 290]] },
  { id: 'gia-lai', origin: false, points: [[208, 290], [255, 275], [240, 338], [195, 320]] },
  { id: 'dak-lak', origin: true, points: [[195, 320], [240, 338], [268, 382], [212, 375]] },
  { id: 'khanh-hoa', origin: true, points: [[268, 382], [295, 370], [285, 435], [248, 420]] },
  { id: 'lam-dong', origin: true, points: [[212, 375], [268, 382], [248, 420], [205, 410]] },
  { id: 'dong-nam-bo', origin: false, points: [[205, 410], [248, 420], [225, 470], [175, 440]] },
  { id: 'dbscl', origin: true, points: [[175, 440], [225, 470], [190, 535], [125, 565], [95, 585], [125, 635], [165, 640], [215, 570], [245, 500]] },
];

export const regionPath = (r: MapRegion): string => `M ${r.points.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;

export interface MapIslandSpec {
  id: 'hoang-sa' | 'truong-sa' | 'phu-quoc';
  /** Số ghi trong chấm đánh dấu và ở dải chú giải đáy khung. */
  n: number;
  label: string;
  /** Vị trí chấm đánh dấu, toạ độ gốc. */
  at: Point;
}

/** Quần đảo Hoàng Sa, Trường Sa và đảo Phú Quốc: chấm số trên bản đồ, tên ở dải chú giải (chỗ cạnh chấm không đủ rộng cho chữ ở khổ 288px). */
export const MAP_ISLANDS: readonly MapIslandSpec[] = [
  { id: 'hoang-sa', n: 1, label: 'Hoàng Sa', at: [318, 282] },
  { id: 'truong-sa', n: 2, label: 'Trường Sa', at: [318, 508] },
  { id: 'phu-quoc', n: 3, label: 'Phú Quốc', at: [80, 582] },
];

// Số đo hộp nhãn (px). Khớp CSS `.brandmap-label` của hai app: nếu đổi CSS thì đổi ở đây.
export const LABEL_METRICS = {
  padX: 6,
  padY: 4,
  border: 1,
  nameLine: 16,
  subLine: 14,
  /** Chữ tên nhãn đậm 12px; ước thừa. */
  nameCharPx: 6.2,
  /** Chữ tỉnh 11px; ước thừa. */
  subCharPx: 5.5,
  minHeight: 44,
  /** Khoảng hở nhỏ nhất giữa hai hộp nhãn. */
  gap: 6,
} as const;

const widthAtMin = (units: number) => (units * MAP_MIN_WIDTH) / MAP_FRAME.w;
const unitsOfPx = (px: number) => (px * MAP_FRAME.w) / MAP_MIN_WIDTH;

/** Số dòng của một đoạn chữ khi ngắt theo từ trong bề rộng `innerPx`, mỗi ký tự chiếm `charPx` (ước thừa). */
export function wrapLineCount(text: string, innerPx: number, charPx: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length * charPx;
    if (used === 0) used = w;
    else if (used + charPx + w <= innerPx) used += charPx + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** Chiều cao hộp nhãn (px) khi cột rộng `columnPx`: tên đậm và tỉnh có thể xuống dòng; không thấp hơn vùng chạm 44px. */
export function labelHeightPx(origin: BrandOrigin, columnPx: number): number {
  const m = LABEL_METRICS;
  const inner = columnPx - 2 * (m.padX + m.border);
  const lines = wrapLineCount(origin.brand, inner, m.nameCharPx) * m.nameLine + wrapLineCount(origin.province, inner, m.subCharPx) * m.subLine;
  return Math.max(m.minHeight, 2 * (m.padY + m.border) + lines);
}

export type MapSide = 'left' | 'right';

/** Cụm Tây Nguyên và Nam Trung Bộ nằm cùng một cột bên phải (phía biển); Thanh Hoá và miền Tây ở cột trái. */
export const MAP_SIDE: Record<string, MapSide> = {
  fuwa3e: 'left',
  bhnong: 'right',
  polang: 'right',
  hector: 'right',
  leplateau: 'right',
  visante: 'right',
  cobote: 'left',
  sokfram: 'left',
};

export interface MapLabelPlacement {
  id: string;
  side: MapSide;
  /** Hộp nhãn theo đơn vị khung: ngang `x0..x1`, tâm dọc `cy`. */
  x0: number;
  x1: number;
  cy: number;
  /** Chiều cao hộp (px, ước thừa). */
  heightPx: number;
  /** Chấm ghim đúng vị trí tỉnh. */
  pin: { x: number; y: number };
  /** Điểm đường dẫn chạm mép hộp nhãn. */
  edge: { x: number; y: number };
}

export interface MapIslandPlacement {
  id: MapIslandSpec['id'];
  n: number;
  label: string;
  /** Tâm chấm số (đơn vị khung). */
  x: number;
  y: number;
}

export interface MapLayout {
  labels: MapLabelPlacement[];
  islands: MapIslandPlacement[];
}

/**
 * Xếp một cột nhãn theo thứ tự chấm từ trên xuống: mỗi nhãn càng gần chấm của nó càng tốt, hai nhãn liền kề cách nhau đúng bằng nửa tổng chiều cao
 * cộng khoảng hở (nên nhãn nào bị đẩy thì cùng cách đều), và cả cột nằm trong khung. Là hồi quy đơn điệu (gộp khối kề nhau) trên toạ độ đã trừ tích luỹ
 * khoảng cách.
 */
export function stackColumn(targets: number[], heights: number[], gap: number, lo: number, hi: number): number[] {
  const n = targets.length;
  if (n === 0) return [];
  const d: number[] = [];
  for (let i = 1; i < n; i++) d.push((heights[i - 1]! + heights[i]!) / 2 + gap);
  const offset: number[] = [0];
  for (let i = 1; i < n; i++) offset.push(offset[i - 1]! + d[i - 1]!);
  const t = targets.map((v, i) => v - offset[i]!);
  const blocks: { sum: number; count: number }[] = [];
  for (const v of t) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.sum / blocks[blocks.length - 2]!.count > blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.count) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      blocks.push({ sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  const q = blocks.flatMap((b) => Array.from({ length: b.count }, () => b.sum / b.count));
  const pos = q.map((v, i) => v + offset[i]!);
  const top = pos[0]! - heights[0]! / 2;
  const bottom = pos[n - 1]! + heights[n - 1]! / 2;
  let shift = 0;
  if (top < lo) shift = lo - top;
  else if (bottom > hi) shift = hi - bottom;
  return pos.map((v) => v + shift);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Đoạn thẳng (a, b) có cắt hình chữ nhật (đơn vị bất kỳ, cùng hệ) không. */
export function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.left) && clip(dx, r.right - a.x) && clip(-dy, a.y - r.top) && clip(dy, r.bottom - a.y);
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

type Seg = { edge: { x: number; y: number }; pin: { x: number; y: number } };

/** Hai đoạn nối nhãn với chấm có cắt nhau không. */
export function segmentsCross(a: Seg, b: Seg): boolean {
  const ccw = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return ccw(a.edge, b.edge, b.pin) !== ccw(a.pin, b.edge, b.pin) && ccw(a.edge, a.pin, b.edge) !== ccw(a.edge, a.pin, b.pin);
}

function buildLayout(): MapLayout {
  const columnPx = widthAtMin(COLUMN_W);
  const gapUnits = unitsOfPx(LABEL_METRICS.gap);
  const labels: MapLabelPlacement[] = [];
  for (const side of ['left', 'right'] as const) {
    const items = BRAND_ORIGINS.filter((o) => MAP_SIDE[o.id] === side).map((o) => ({ o, pin: geoToFrame(o.geo), heightPx: labelHeightPx(o, columnPx) }));
    const col = MAP_COLUMNS[side];
    const edgeX = side === 'left' ? col.x1 : col.x0;
    const lo = unitsOfPx(LABEL_METRICS.gap);
    const hi = MAP_FRAME.h - MAP_LEGEND_H;
    // Thứ tự nhãn trong cột: thử mọi hoán vị, bỏ cách xếp có hai đường dẫn cắt nhau, lấy cách ít lệch khỏi chấm nhất (cột nhiều nhất 5 nhãn, 120 hoán vị).
    let best: { order: typeof items; cys: number[]; cost: number } | undefined;
    for (const order of permutations(items)) {
      const cys = stackColumn(
        order.map((i) => i.pin.y),
        order.map((i) => unitsOfPx(i.heightPx)),
        gapUnits,
        lo,
        hi,
      );
      const segs = order.map((it, i) => ({ edge: { x: edgeX, y: cys[i]! }, pin: it.pin }));
      if (segs.some((a, i) => segs.some((b, j) => j > i && segmentsCross(a, b)))) continue;
      const cost = order.reduce((sum, it, i) => sum + (cys[i]! - it.pin.y) ** 2, 0);
      if (!best || cost < best.cost) best = { order, cys, cost };
    }
    const chosen = best ?? (() => {
      const order = [...items].sort((a, b) => a.pin.y - b.pin.y);
      return { order, cys: stackColumn(order.map((i) => i.pin.y), order.map((i) => unitsOfPx(i.heightPx)), gapUnits, lo, hi), cost: 0 };
    })();
    chosen.order.forEach((it, i) => {
      labels.push({ id: it.o.id, side, x0: col.x0, x1: col.x1, cy: chosen.cys[i]!, heightPx: it.heightPx, pin: it.pin, edge: { x: edgeX, y: chosen.cys[i]! } });
    });
  }
  const order = new Map(BRAND_ORIGINS.map((o, i) => [o.id, i]));
  labels.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const islands = MAP_ISLANDS.map<MapIslandPlacement>((i) => ({ id: i.id, n: i.n, label: i.label, ...geoToFrame({ x: i.at[0], y: i.at[1] }) }));

  return { labels, islands };
}

export const MAP_LAYOUT: MapLayout = buildLayout();

export interface MapBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Hộp nhãn (px) khi khung rộng `widthPx`: dùng để kiểm các hộp không chồng nhau ở mọi khổ từ `MAP_MIN_WIDTH`. Chiều cao là ước thừa. */
export function labelBoxesPx(widthPx: number): MapBox[] {
  const k = widthPx / MAP_FRAME.w;
  return MAP_LAYOUT.labels.map((l) => ({
    id: l.id,
    left: l.x0 * k,
    right: l.x1 * k,
    top: l.cy * k - l.heightPx / 2,
    bottom: l.cy * k + l.heightPx / 2,
  }));
}

/** Hộp chấm số đảo (px) khi khung rộng `widthPx`. */
export function islandBoxesPx(widthPx: number): MapBox[] {
  const k = widthPx / MAP_FRAME.w;
  const r = ISLAND_PIN_PX / 2;
  return MAP_LAYOUT.islands.map((i) => ({ id: i.id, left: i.x * k - r, right: i.x * k + r, top: i.y * k - r, bottom: i.y * k + r }));
}

/** Cao khung (px) khi rộng `widthPx`. */
export const mapFrameHeightPx = (widthPx: number): number => (widthPx * MAP_FRAME.h) / MAP_FRAME.w;
