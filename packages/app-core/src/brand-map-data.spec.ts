import { describe, expect, it } from 'vitest';
import {
  ISLAND_PIN_PX,
  LABEL_METRICS,
  MAP_COLUMNS,
  MAP_FRAME,
  MAP_ISLANDS,
  MAP_LAYOUT,
  MAP_LEGEND_H,
  MAP_MAX_WIDTH,
  MAP_MIN_WIDTH,
  MAP_REGIONS,
  geoToFrame,
  islandBoxesPx,
  labelBoxesPx,
  labelHeightPx,
  mapFrameHeightPx,
  regionPath,
  segmentHitsRect,
  segmentsCross,
  stackColumn,
  wrapLineCount,
  type MapBox,
} from './brand-map-data';
import { BRAND_ORIGINS } from './brand-origins';

const hit = (a: MapBox, b: MapBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const WIDTHS = [MAP_MIN_WIDTH, 300, 320, 343, 360, 375, 390, 414, 480, 560];

describe('hộp nhãn bản đồ không chồng nhau ở mọi khổ từ 288px đến 560px', () => {
  it.each(WIDTHS)('khổ %ipx: không cặp hộp nhãn nào chồng nhau, không đè chấm số đảo', (w) => {
    const labels = labelBoxesPx(w);
    const islands = islandBoxesPx(w);
    const clashes: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) if (hit(labels[i]!, labels[j]!)) clashes.push(`${labels[i]!.id} x ${labels[j]!.id}`);
      for (const isl of islands) if (hit(labels[i]!, isl)) clashes.push(`${labels[i]!.id} x ${isl.id}`);
    }
    expect(clashes).toEqual([]);
  });

  it.each(WIDTHS)('khổ %ipx: mọi hộp nhãn cao ít nhất 44px và nằm trong khung, trên dải chú giải', (w) => {
    const frameH = mapFrameHeightPx(w);
    const legendTop = frameH - (MAP_LEGEND_H * w) / MAP_FRAME.w;
    for (const b of labelBoxesPx(w)) {
      expect(b.bottom - b.top, b.id).toBeGreaterThanOrEqual(44 - 1e-6);
      expect(b.left, b.id).toBeGreaterThanOrEqual(0);
      expect(b.right, b.id).toBeLessThanOrEqual(w);
      expect(b.top, b.id).toBeGreaterThanOrEqual(0);
      expect(b.bottom, b.id).toBeLessThanOrEqual(legendTop);
    }
  });

  it('khổ hẹp nhất cũng đủ chỗ cho chữ: hộp rộng đủ chứa tên nhãn đậm 12px trên một dòng', () => {
    const colPx = ((MAP_COLUMNS.left.x1 - MAP_COLUMNS.left.x0) * MAP_MIN_WIDTH) / MAP_FRAME.w;
    const inner = colPx - 2 * (LABEL_METRICS.padX + LABEL_METRICS.border);
    for (const o of BRAND_ORIGINS) expect(wrapLineCount(o.brand, inner, LABEL_METRICS.nameCharPx), o.brand).toBe(1);
  });
});

describe('bố cục hai cột', () => {
  it('đủ 8 nhãn, mỗi nhãn đúng một vị trí; Thanh Hoá và miền Tây ở cột trái, cụm Tây Nguyên–Nam Trung Bộ cùng cột phải', () => {
    expect(MAP_LAYOUT.labels.map((l) => l.id)).toEqual(BRAND_ORIGINS.map((o) => o.id));
    const side = Object.fromEntries(MAP_LAYOUT.labels.map((l) => [l.id, l.side]));
    expect(side.fuwa3e).toBe('left');
    expect(side.cobote).toBe('left');
    expect(side.sokfram).toBe('left');
    for (const id of ['polang', 'hector', 'leplateau', 'visante']) expect(side[id], id).toBe('right');
  });

  it('cột trái ở trái chấm, cột phải ở phải; hộp nằm trong hai cột', () => {
    for (const l of MAP_LAYOUT.labels) {
      expect(l.x0).toBe(MAP_COLUMNS[l.side].x0);
      expect(l.x1).toBe(MAP_COLUMNS[l.side].x1);
      expect(l.edge.x).toBe(l.side === 'left' ? l.x1 : l.x0);
    }
  });

  it('cụm Tây Nguyên–Nam Trung Bộ chiếm bốn ô liền nhau của cột phải; Thanh Hoá nằm trên hai nhãn miền Tây', () => {
    const right = MAP_LAYOUT.labels.filter((l) => l.side === 'right').sort((a, b) => a.cy - b.cy).map((l) => l.id);
    const cluster = right.map((id, i) => (['polang', 'hector', 'leplateau', 'visante'].includes(id) ? i : -1)).filter((i) => i >= 0);
    expect(cluster).toHaveLength(4);
    expect(cluster[3]! - cluster[0]!).toBe(3);
    const left = MAP_LAYOUT.labels.filter((l) => l.side === 'left').sort((a, b) => a.cy - b.cy).map((l) => l.id);
    expect(left[0]).toBe('fuwa3e');
    expect(new Set(left.slice(1))).toEqual(new Set(['cobote', 'sokfram']));
  });

  it('hai nhãn cạnh nhau trong cột cách đúng khoảng hở thiết kế khi bị đẩy xa chấm (cách đều)', () => {
    const right = MAP_LAYOUT.labels.filter((l) => l.side === 'right').sort((a, b) => a.cy - b.cy);
    const cluster = right.filter((l) => ['polang', 'hector', 'leplateau', 'visante'].includes(l.id));
    const k = MAP_MIN_WIDTH / MAP_FRAME.w;
    const gaps: number[] = [];
    for (let i = 1; i < cluster.length; i++) {
      const a = cluster[i - 1]!;
      const b = cluster[i]!;
      gaps.push((b.cy - a.cy) * k - (a.heightPx + b.heightPx) / 2);
    }
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(LABEL_METRICS.gap - 0.01);
  });

  it('đường dẫn của hai nhãn cùng cột không cắt nhau và không cắt hộp của nhãn khác', () => {
    const labels = MAP_LAYOUT.labels;
    const crossings: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) if (segmentsCross(labels[i]!, labels[j]!)) crossings.push(`${labels[i]!.id} x ${labels[j]!.id}`);
    }
    expect(crossings).toEqual([]);

    const k = MAP_MIN_WIDTH / MAP_FRAME.w;
    for (const l of labels) {
      for (const other of labels) {
        if (other.id === l.id) continue;
        const rect = { left: other.x0, right: other.x1, top: other.cy - other.heightPx / 2 / k, bottom: other.cy + other.heightPx / 2 / k };
        expect(segmentHitsRect(l.edge, l.pin, rect), `${l.id} qua hộp ${other.id}`).toBe(false);
      }
    }
  });
});

describe('chấm ghim và chấm đảo', () => {
  it('chấm ghim các nhãn cách nhau ít nhất 12px ở khổ hẹp nhất (chấm 10px không đè nhau)', () => {
    const k = MAP_MIN_WIDTH / MAP_FRAME.w;
    for (let i = 0; i < MAP_LAYOUT.labels.length; i++) {
      for (let j = i + 1; j < MAP_LAYOUT.labels.length; j++) {
        const a = MAP_LAYOUT.labels[i]!.pin;
        const b = MAP_LAYOUT.labels[j]!.pin;
        expect(Math.hypot(a.x - b.x, a.y - b.y) * k, `${MAP_LAYOUT.labels[i]!.id} - ${MAP_LAYOUT.labels[j]!.id}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('chấm ghim đúng vị trí tỉnh: nằm trong khung và giữa hai cột nhãn', () => {
    for (const l of MAP_LAYOUT.labels) {
      expect(l.pin.x).toBeGreaterThan(MAP_COLUMNS.left.x1);
      expect(l.pin.x).toBeLessThan(MAP_COLUMNS.right.x0);
      expect(l.pin.y).toBeGreaterThan(0);
      expect(l.pin.y).toBeLessThan(MAP_FRAME.h - MAP_LEGEND_H);
      const o = BRAND_ORIGINS.find((x) => x.id === l.id)!;
      expect(l.pin).toEqual(geoToFrame(o.geo));
    }
  });

  it('mỗi nhãn nằm trong một vùng tô đậm (vùng nguyên liệu) của sơ đồ', () => {
    const inside = (p: { x: number; y: number }, poly: readonly (readonly [number, number])[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!;
        const [xj, yj] = poly[j]!;
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (const o of BRAND_ORIGINS) {
      const region = MAP_REGIONS.filter((r) => r.origin).find((r) => inside(o.geo, r.points));
      expect(region, o.brand).toBeDefined();
    }
  });

  it('ba đảo (Hoàng Sa, Trường Sa, Phú Quốc) có chấm số và tên ở dải chú giải; chấm không đè hộp nhãn', () => {
    expect(MAP_ISLANDS.map((i) => i.label)).toEqual(['Hoàng Sa', 'Trường Sa', 'Phú Quốc']);
    expect(MAP_LAYOUT.islands.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(ISLAND_PIN_PX).toBeGreaterThanOrEqual(16);
    expect(regionPath(MAP_REGIONS[0]!)).toMatch(/^M [\d. ]+ L .* Z$/);
  });
});

describe('stackColumn — xếp cột nhãn', () => {
  it('chấm thưa thì mỗi nhãn đúng tâm chấm của nó', () => {
    expect(stackColumn([10, 50, 90], [10, 10, 10], 2, 0, 100)).toEqual([10, 50, 90]);
  });

  it('chấm sát nhau thì đẩy ra cách đều đúng khoảng (nửa tổng cao + hở), giữ thứ tự', () => {
    const pos = stackColumn([50, 51, 52], [10, 10, 10], 2, 0, 100);
    expect(pos[1]! - pos[0]!).toBeCloseTo(12);
    expect(pos[2]! - pos[1]!).toBeCloseTo(12);
    expect(pos[1]).toBeCloseTo(51);
  });

  it('không vượt khung: cột sát mép được kéo vào', () => {
    const pos = stackColumn([1, 2], [10, 10], 2, 0, 100);
    expect(pos[0]! - 5).toBeGreaterThanOrEqual(0);
    const low = stackColumn([99, 99], [10, 10], 2, 0, 100);
    expect(low[1]! + 5).toBeLessThanOrEqual(100);
  });

  it('cột rỗng', () => {
    expect(stackColumn([], [], 2, 0, 100)).toEqual([]);
  });
});

describe('ước lượng chiều cao hộp', () => {
  it('wrapLineCount ngắt theo từ', () => {
    expect(wrapLineCount('Thanh Hóa', 100, 6)).toBe(1);
    expect(wrapLineCount('Khánh Hòa (Nha Trang)', 70, 5.5)).toBe(2);
    expect(wrapLineCount('', 70, 5.5)).toBe(1);
  });

  it('không hộp nào thấp hơn vùng chạm 44px; tỉnh dài làm hộp cao hơn', () => {
    const col = (27 * MAP_MIN_WIDTH) / 100;
    for (const o of BRAND_ORIGINS) expect(labelHeightPx(o, col)).toBeGreaterThanOrEqual(44);
    const visante = BRAND_ORIGINS.find((o) => o.id === 'visante')!;
    expect(labelHeightPx(visante, col)).toBeGreaterThan(labelHeightPx(BRAND_ORIGINS[0]!, col));
  });

  it('bề rộng tối đa lớn hơn tối thiểu; tỉ lệ khung cố định', () => {
    expect(MAP_MAX_WIDTH).toBeGreaterThan(MAP_MIN_WIDTH);
    expect(mapFrameHeightPx(100)).toBe(MAP_FRAME.h);
  });
});
