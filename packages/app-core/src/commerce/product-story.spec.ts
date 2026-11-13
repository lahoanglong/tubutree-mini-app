import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStoryConfig, type ProductStoryConfig, type StoryScene } from '@tubutree/shared-types';
import {
  ambientVar,
  arcSlot,
  buildArcScene,
  buildDefaultStoryConfig,
  layersUpTo,
  resolveStoryConfig,
  stageLayers,
  STORY_LAYER_WIDTH_PCT,
  STORY_PRODUCT_INSET_PCT,
  storyImageFrame,
  storyView,
  toneVar,
  type StoryProductInput,
} from './product-story';
import { STORY_PRESETS } from './story-presets';

const variations = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, name: `${(i + 1) * 100}ml` }));
const product = (over: Partial<StoryProductInput> = {}): StoryProductInput => ({
  slug: 'san-pham-la',
  name: 'Sản phẩm lạ',
  brand: 'Tubu',
  shortDesc: null,
  certifications: [],
  ingredients: null,
  variations: variations(1),
  storyConfig: null,
  ...over,
});
const polang = [
  { name: 'Tinh dầu bưởi', percentage: '2%', benefit: 'Kích thích mọc tóc' },
  { name: 'Bồ kết', benefit: 'Làm sạch dịu nhẹ' },
  { name: 'Hương nhu', benefit: 'Thư giãn da đầu' },
];
const stored = (label: string, ids: string[] = ['v1', 'v2']): ProductStoryConfig => ({
  version: 1,
  enabled: true,
  scenes: [{ kind: 'variant_arc', items: ids.map((id, i) => ({ variationId: id, label: i === 0 ? label : `Mục ${i + 1}`, ambient: 'sky' as const })) }],
});
const assembly: StoryScene = { kind: 'ingredient_assembly', steps: [{ title: 'Bước', body: 'x', layers: [{ id: 'l', spriteId: 'honey-drop', label: 'Mật', from: 'top', xPct: 50, yPct: 50, scale: 1, rotateDeg: 0 }] }] };
const arcIds = (c: ProductStoryConfig | null) => {
  const a = c?.scenes.find((s) => s.kind === 'variant_arc');
  return a && a.kind === 'variant_arc' ? a.items.map((i) => i.variationId) : null;
};

describe('token var', () => {
  it('ambientVar và toneVar trả biến CSS semantic, không hex', () => {
    expect(ambientVar('leaf')).toBe('var(--color-story-ambient-leaf)');
    expect(toneVar('ink')).toBe('var(--color-story-tone-ink)');
  });
});

describe('buildArcScene', () => {
  it('dưới 2 biến thể thì không có vòng cung', () => {
    expect(buildArcScene([])).toBeNull();
    expect(buildArcScene(variations(1))).toBeNull();
  });
  it('map biến thể thật, xoay vòng màu quầng, tối đa 8 mục', () => {
    const s = buildArcScene(variations(10), ['leaf', 'amber']);
    expect(s && s.kind === 'variant_arc' && s.items).toHaveLength(8);
    if (s && s.kind === 'variant_arc') {
      expect(s.items[0]).toEqual({ variationId: 'v1', label: '100ml', ambient: 'leaf' });
      expect(s.items[1]?.ambient).toBe('amber');
      expect(s.items[2]?.ambient).toBe('leaf');
    }
  });
});

describe('nhãn vòng cung khi tên phân loại hỏng (đồng bộ Pancake ghi "[object Object]" hoặc để trống)', () => {
  const labels = (vs: readonly { id: string; name: string; attributes?: unknown }[]) => {
    const s = buildArcScene(vs);
    return s && s.kind === 'variant_arc' ? s.items.map((i) => i.label) : null;
  };
  it('tên "[object Object]" thì lấy giá trị thuộc tính (mảng {name, value} của Pancake), nhiều thuộc tính nối bằng " · "', () => {
    expect(
      labels([
        { id: 'a', name: '[object Object]', attributes: [{ name: 'PHÂN LOẠI', value: '300g' }] },
        { id: 'b', name: '[object Object] - [object Object]', attributes: [{ name: 'PHÂN LOẠI', value: '1KG' }, { name: 'HƯƠNG', value: 'Bạc hà' }] },
      ]),
    ).toEqual(['300g', '1KG · Bạc hà']);
  });
  it('tên rỗng thì lấy giá trị của thuộc tính dạng bản ghi', () => {
    expect(labels([{ id: 'a', name: '', attributes: { size: '500ml' } }, { id: 'b', name: '  ', attributes: { size: '1l', color: 'xanh' } }])).toEqual(['500ml', '1l · xanh']);
  });
  it('không có thuộc tính dùng được thì #số thứ tự, không bao giờ để chữ "[object Object]"', () => {
    expect(labels([{ id: 'a', name: '[object Object]' }, { id: 'b', name: '', attributes: [] }, { id: 'c', name: 'x', attributes: [{ value: 5 }, null, 'lạ'] }])).toEqual(['#1', '#2', 'x']);
  });
  it('tên bình thường giữ nguyên, kể cả khi có thuộc tính', () => {
    expect(labels([{ id: 'a', name: 'Chai 300ml', attributes: [{ value: '300ml' }] }, { id: 'b', name: 'Chai 500ml' }])).toEqual(['Chai 300ml', 'Chai 500ml']);
  });
});

describe('buildDefaultStoryConfig', () => {
  it('thành phần + 2 biến thể → vòng cung, lắp ghép ≥3 bước, điểm chỉ lấy phần trăm thật; qua parseStoryConfig', () => {
    const cfg = buildDefaultStoryConfig(product({ ingredients: polang, variations: variations(2) }));
    expect(cfg).not.toBeNull();
    expect(parseStoryConfig(cfg).ok).toBe(true);
    const kinds = cfg!.scenes.map((s) => s.kind);
    expect(kinds).toEqual(['variant_arc', 'ingredient_assembly', 'hud_callouts']);
    const asm = cfg!.scenes[1]!;
    expect(asm.kind === 'ingredient_assembly' && asm.steps.length).toBeGreaterThanOrEqual(3);
    const hud = cfg!.scenes[2]!;
    if (hud.kind === 'hud_callouts') {
      expect(hud.points[0]).toMatchObject({ label: 'Tinh dầu bưởi', value: '2%', barPct: 2 });
      expect(hud.points.length).toBeLessThanOrEqual(4);
    }
  });

  it('chỉ có biến thể (2+) thì chỉ vòng cung; chỉ 1 biến thể và không thành phần thì null', () => {
    const only = buildDefaultStoryConfig(product({ variations: variations(2) }));
    expect(only?.scenes.map((s) => s.kind)).toEqual(['variant_arc']);
    expect(buildDefaultStoryConfig(product())).toBeNull();
    expect(buildDefaultStoryConfig(product({ ingredients: [] }))).toBeNull();
  });

  it('cột Json cũ kiểu lạ không bao giờ ném lỗi', () => {
    const weird: unknown[] = ['Nước, muối', {}, { a: 1 }, [null, 5, 'Mật ong', { name: '' }, { name: 'Bồ kết', percentage: 7 }], 42, true, [{ name: 'x'.repeat(500) }]];
    for (const ingredients of weird) {
      expect(() => buildDefaultStoryConfig(product({ ingredients: ingredients as never, variations: variations(2) }))).not.toThrow();
      const cfg = buildDefaultStoryConfig(product({ ingredients: ingredients as never, variations: variations(2) }));
      if (cfg) expect(parseStoryConfig(cfg).ok).toBe(true);
    }
  });

  it('phần trăm không phải số (nhiều giá trị) thì giữ chữ, không đặt barPct', () => {
    const cfg = buildDefaultStoryConfig(product({ ingredients: [{ name: 'Chiết xuất', percentage: 'vừa đủ' }] }));
    const hud = cfg?.scenes.find((s) => s.kind === 'hud_callouts');
    if (hud && hud.kind === 'hud_callouts') {
      expect(hud.points[0]?.value).toBe('vừa đủ');
      expect(hud.points[0]).not.toHaveProperty('barPct');
    }
  });
});

describe('resolveStoryConfig', () => {
  it('cấu hình đã lưu thắng preset', () => {
    const cfg = resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', variations: variations(2), storyConfig: stored('Đã lưu') }));
    expect(cfg?.scenes[0]).toMatchObject({ kind: 'variant_arc', items: [{ label: 'Đã lưu' }, { label: 'Mục 2' }] });
  });

  it('vòng cung đã lưu khớp đúng biến thể thật thì giữ nguyên chữ và màu của admin', () => {
    const cfg = resolveStoryConfig(product({ variations: variations(2), storyConfig: stored('Chai nhỏ') }));
    expect(cfg?.scenes[0]).toMatchObject({ items: [{ variationId: 'v1', label: 'Chai nhỏ', ambient: 'sky' }, { variationId: 'v2' }] });
  });

  it('vòng cung đã lưu trỏ biến thể đã xoá thì dựng lại từ biến thể thật, không còn mục mồ côi', () => {
    const cfg = resolveStoryConfig(product({ variations: variations(2), storyConfig: stored('x', ['v1', 'v9']) }));
    expect(arcIds(cfg)).toEqual(['v1', 'v2']);
  });

  it('vòng cung đã lưu thiếu một biến thể đang bán thì dựng lại để khách chọn được đủ', () => {
    const cfg = resolveStoryConfig(product({ variations: variations(3), storyConfig: stored('x', ['v1', 'v2']) }));
    expect(arcIds(cfg)).toEqual(['v1', 'v2', 'v3']);
  });

  it('mục vòng cung không có variationId không chọn được gì nên cũng dựng lại', () => {
    const noId: ProductStoryConfig = { version: 1, enabled: true, scenes: [{ kind: 'variant_arc', items: [{ label: 'a', ambient: 'leaf' }, { label: 'b', ambient: 'sky' }] }] };
    expect(arcIds(resolveStoryConfig(product({ variations: variations(2), storyConfig: noId })))).toEqual(['v1', 'v2']);
  });

  it('còn dưới 2 biến thể thì bỏ vòng cung đã lưu, các cảnh khác vẫn giữ; hết cảnh thì null', () => {
    const mixed: ProductStoryConfig = { version: 1, enabled: true, scenes: [...stored('x').scenes, assembly] };
    const one = resolveStoryConfig(product({ variations: variations(1), storyConfig: mixed }));
    expect(one?.scenes.map((s) => s.kind)).toEqual(['ingredient_assembly']);
    expect(resolveStoryConfig(product({ variations: variations(1), storyConfig: stored('x') }))).toBeNull();
  });

  it('enabled:false tắt hẳn, kể cả khi có preset', () => {
    expect(resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', storyConfig: { ...stored('x'), enabled: false } }))).toBeNull();
  });

  it('cấu hình lưu hỏng thì rơi xuống preset, không ném lỗi', () => {
    const bad = { version: 9 } as unknown as ProductStoryConfig;
    const cfg = resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', storyConfig: bad, variations: variations(2) }));
    expect(cfg?.scenes.some((s) => s.kind === 'ingredient_assembly')).toBe(true);
  });

  it('preset theo slug, chèn vòng cung từ biến thể thật khi có từ 2 biến thể', () => {
    const two = resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', variations: variations(2) }));
    expect(two?.scenes[0]?.kind).toBe('variant_arc');
    expect(two?.scenes).toHaveLength(STORY_PRESETS['dau-goi-buoi-po-lang']!.scenes.length + 1);
    const one = resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', variations: variations(1) }));
    expect(one?.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
  });

  it('không preset thì tự sinh từ thành phần; không gì cả thì null (trang không đổi)', () => {
    expect(resolveStoryConfig(product({ ingredients: polang }))?.scenes.some((s) => s.kind === 'ingredient_assembly')).toBe(true);
    expect(resolveStoryConfig(product())).toBeNull();
  });
});

describe('storyView', () => {
  const cfg = resolveStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', variations: variations(2) }))!;

  it('bước có số 01..05, vòng cung và điểm chỉ lấy từ cảnh', () => {
    const v = storyView(cfg, { reducedMotion: false });
    expect(v.animated).toBe(true);
    expect(v.steps.map((s) => s.num)).toEqual(['01', '02', '03', '04', '05']);
    expect(v.arc).toHaveLength(2);
    expect(v.hud?.points.length).toBeGreaterThanOrEqual(3);
    expect(v.staticLayers).toEqual([]);
  });

  it('cấu hình cũ có vòng cung rỗng không làm hai app vỡ: arc là null', () => {
    const raw = { version: 1, enabled: true, scenes: [{ kind: 'variant_arc', items: [] }, assembly] } as unknown as ProductStoryConfig;
    expect(storyView(raw, { reducedMotion: false }).arc).toBeNull();
  });

  it('giảm chuyển động: animated=false và gom mọi lớp nguyên liệu (không trùng id) cho bản tĩnh', () => {
    const v = storyView(cfg, { reducedMotion: true });
    expect(v.animated).toBe(false);
    expect(v.staticLayers.length).toBeGreaterThan(0);
    expect(new Set(v.staticLayers.map((l) => l.id)).size).toBe(v.staticLayers.length);
  });

  it('cảnh thiếu thì trường tương ứng là null', () => {
    const v = storyView(stored('a'), { reducedMotion: false });
    expect(v.steps).toEqual([]);
    expect(v.hud).toBeNull();
  });

  it('layersUpTo tích luỹ lớp tới bước đang xem; chỉ số ngoài khoảng được kẹp', () => {
    const v = storyView(cfg, { reducedMotion: false });
    const n0 = layersUpTo(v.steps, 0).length;
    expect(n0).toBe(v.steps[0]!.layers.length);
    expect(layersUpTo(v.steps, 2).length).toBeGreaterThan(n0);
    expect(layersUpTo(v.steps, 99)).toHaveLength(layersUpTo(v.steps, v.steps.length - 1).length);
    expect(layersUpTo(v.steps, -3)).toHaveLength(n0);
    expect(layersUpTo([], 0)).toEqual([]);
  });
});

describe('khung ảnh sản phẩm trên sân khấu', () => {
  const base: ProductStoryConfig = { version: 1, enabled: true, scenes: [assembly] };

  it('không đặt gì: có ảnh tách nền thì cutout, không có (ảnh gốc poster hay ảnh chụp có nền) thì thẻ nổi', () => {
    expect(storyImageFrame(base)).toBe('floating-card');
    expect(storyImageFrame({ ...base, cutoutUrl: 'https://cdn.example.com/chai.webp' })).toBe('cutout');
  });

  it('admin đặt imageFrame thì theo admin, kể cả khi có ảnh tách nền', () => {
    expect(storyImageFrame({ ...base, cutoutUrl: 'https://cdn.example.com/chai.webp', imageFrame: 'floating-card' })).toBe('floating-card');
    expect(storyImageFrame({ ...base, imageFrame: 'cutout' })).toBe('cutout');
  });

  it('storyView mang khung sang hai app, với cả bản tĩnh khi giảm chuyển động', () => {
    expect(storyView(base, { reducedMotion: false }).frame).toBe('floating-card');
    expect(storyView({ ...base, cutoutUrl: 'https://cdn.example.com/chai.webp' }, { reducedMotion: true }).frame).toBe('cutout');
  });

  it('cấu hình đã lưu có imageFrame giữ nguyên qua resolveStoryConfig', () => {
    const saved = { ...base, imageFrame: 'cutout' };
    expect(resolveStoryConfig(product({ storyConfig: saved }))?.imageFrame).toBe('cutout');
  });
});

describe('ảnh poster không bị phủ gì lên (W133): overlay, points, stageLayers', () => {
  const hud: StoryScene = {
    kind: 'hud_callouts',
    closing: 'Kết',
    points: [
      { id: 'a', xPct: 26, yPct: 34, label: 'Quy cách 500ml', side: 'left' },
      { id: 'b', xPct: 74, yPct: 52, label: 'Thương hiệu', value: 'Fuwa3e', barPct: 40, side: 'right' },
    ],
  };
  const poster: ProductStoryConfig = { version: 1, enabled: true, scenes: [assembly, hud] };
  const cutout: ProductStoryConfig = { ...poster, cutoutUrl: 'https://cdn.example.com/chai.webp' };

  it('ảnh poster (thẻ nổi): overlay=false, không lớp nguyên liệu nào vẽ lên ảnh, điểm nhấn HUD thành chip không toạ độ', () => {
    for (const reducedMotion of [false, true]) {
      const v = storyView(poster, { reducedMotion });
      expect(v.overlay).toBe(false);
      expect(stageLayers(v, 0)).toEqual([]);
      expect(stageLayers(v, 99)).toEqual([]);
      expect(v.points).toEqual([
        { id: 'a', label: 'Quy cách 500ml' },
        { id: 'b', label: 'Thương hiệu', value: 'Fuwa3e' },
      ]);
      expect(v.points.every((p) => !('xPct' in p) && !('yPct' in p) && !('side' in p))).toBe(true);
      expect(v.hud?.points).toHaveLength(2);
    }
  });

  it('ảnh tách nền thật (cutout): overlay=true, lớp rơi theo bước, HUD vẽ trên ảnh nên không có chip', () => {
    const v = storyView(cutout, { reducedMotion: false });
    expect(v.overlay).toBe(true);
    expect(v.points).toEqual([]);
    expect(stageLayers(v, 0)).toHaveLength(1);
    const still = storyView(cutout, { reducedMotion: true });
    expect(stageLayers(still, 0)).toEqual(still.staticLayers);
    expect(still.staticLayers).toHaveLength(1);
  });

  it('admin đặt imageFrame quyết định overlay: cutout bật, floating-card tắt kể cả khi có ảnh tách nền', () => {
    expect(storyView({ ...poster, imageFrame: 'cutout' }, { reducedMotion: false }).overlay).toBe(true);
    expect(storyView({ ...cutout, imageFrame: 'floating-card' }, { reducedMotion: false }).overlay).toBe(false);
  });

  it('không có HUD thì không có chip', () => {
    expect(storyView({ version: 1, enabled: true, scenes: [assembly] }, { reducedMotion: false }).points).toEqual([]);
  });

  it('mọi kịch bản đợt đầu và catalog (không có ảnh tách nền) đều là poster: không lớp nào đè ảnh, mọi điểm nhấn thành chip', () => {
    for (const slug of ['duong-hoa-dua-sokfarm', 've-sinh-nha-tam-va-toilet-fuwa3e-500ml', 'xit-tram-cho-be-pineboo-150ml']) {
      const cfg = resolveStoryConfig(product({ slug, variations: variations(1) }));
      if (!cfg) continue;
      const v = storyView(cfg, { reducedMotion: false });
      expect(v.overlay, slug).toBe(false);
      expect(stageLayers(v, v.steps.length - 1), slug).toEqual([]);
      expect(v.points.length, slug).toBe(v.hud?.points.length ?? 0);
    }
  });
});

describe('khung sân khấu dùng chung', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');
  const inset = (css: string) => /\.tubu-story-product\s*\{[^}]*?inset:\s*(\d+(?:\.\d+)?)%/.exec(css)?.[1];

  it('toạ độ xPct/yPct tính trên khung vuông; ảnh sản phẩm lề cùng một số ở CSS Mini, CSS web và Studio', () => {
    expect(inset(read('apps/miniapp/src/css/story.css'))).toBe(String(STORY_PRODUCT_INSET_PCT));
    expect(inset(read('apps/web/src/components/mini/mini.css'))).toBe(String(STORY_PRODUCT_INSET_PCT));
    const studio = read('apps/web/src/components/admin/product-story-studio.tsx');
    expect(studio).toContain('STORY_PRODUCT_INSET_PCT');
    expect(studio).toContain('aspect-square');
  });

  it('lớp nguyên liệu rộng đúng STORY_LAYER_WIDTH_PCT khung sân khấu ở CSS Mini và web, không có cỡ rem cố định', () => {
    const widths = (css: string) => Array.from(css.matchAll(/\.tubu-story-layer\s*\{[^}]*?\bwidth:\s*([^;}\s]+)/g)).map((m) => m[1]);
    for (const rel of ['apps/miniapp/src/css/story.css', 'apps/web/src/components/mini/mini.css']) {
      const found = widths(read(rel));
      expect(found.length, rel).toBeGreaterThan(0);
      for (const w of found) expect(w, rel).toBe(`${STORY_LAYER_WIDTH_PCT}%`);
    }
  });
});

describe('arcSlot', () => {
  it('mục đang chọn phóng 1.22x, nghiêng -6deg, nằm giữa', () => {
    expect(arcSlot(1, 1, 3)).toMatchObject({ scale: 1.22, rotateDeg: -6, offset: 0 });
  });
  it('mục khác nhỏ hơn, lệch theo khoảng cách tới mục chọn, và luôn hữu hạn', () => {
    const left = arcSlot(0, 1, 3);
    const right = arcSlot(2, 1, 3);
    expect(left.scale).toBeLessThan(1.22);
    expect(left.offset).toBeLessThan(0);
    expect(right.offset).toBeGreaterThan(0);
    for (const s of [arcSlot(0, 0, 1), arcSlot(5, 0, 8), arcSlot(0, 7, 8)]) {
      for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
