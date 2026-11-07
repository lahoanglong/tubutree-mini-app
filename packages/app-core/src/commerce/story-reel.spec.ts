import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS, type ProductStoryConfig } from '@tubutree/shared-types';
import {
  markReelSeen,
  readReelSeen,
  REEL_MAX_ITEMS,
  REEL_MIN_ITEMS,
  REEL_SEEN_KEY,
  reelDisabled,
  reelFallbackConfig,
  reelItems,
  reelNeighbor,
  resolveReelStoryConfig,
  type ReelProductInput,
} from './story-reel';
import { storyView } from './product-story';

const card = (slug: string, over: Partial<{ name: string; inStock: boolean; thumbnail: string | null }> = {}) => ({
  slug,
  name: over.name ?? `Món ${slug}`,
  thumbnail: over.thumbnail ?? null,
  inStock: over.inStock ?? true,
});

const product = (over: Partial<ReelProductInput> = {}): ReelProductInput => ({
  slug: 'mon-la',
  name: 'Món lạ',
  brand: 'Tubu Tree',
  variations: [],
  ...over,
});

const textOf = (cfg: ProductStoryConfig): string[] =>
  cfg.scenes.flatMap((sc) => (sc.kind === 'ingredient_assembly' ? sc.steps.flatMap((st) => [st.title, st.body]) : sc.kind === 'hud_callouts' ? [sc.closing] : []));

describe('reelItems', () => {
  it('giữ thứ tự nguồn, bỏ món hết hàng, trùng slug, tên rỗng', () => {
    const out = reelItems([card('a'), card('b', { inStock: false }), card('a'), card('c', { name: '  ' }), card('d'), card('e'), card('f')]);
    expect(out.map((x) => x.slug)).toEqual(['a', 'd', 'e', 'f']);
  });

  it(`tối đa ${REEL_MAX_ITEMS} vòng`, () => {
    const out = reelItems(Array.from({ length: 20 }, (_, i) => card(`s${i}`)));
    expect(out).toHaveLength(REEL_MAX_ITEMS);
    expect(out[0]!.slug).toBe('s0');
  });

  it(`dưới ${REEL_MIN_ITEMS} món thì dải ẩn (rỗng), không để tiêu đề trơ`, () => {
    expect(reelItems([card('a'), card('b')])).toEqual([]);
    expect(reelItems([card('a'), card('b'), card('c')])).toHaveLength(3);
    expect(reelItems(null)).toEqual([]);
    expect(reelItems(undefined)).toEqual([]);
  });
});

describe('reelFallbackConfig', () => {
  it('qua parseStoryConfig, bật sẵn, không lớp nguyên liệu, không cảnh vòng cung', () => {
    const cfg = reelFallbackConfig(product());
    const r = parseStoryConfig(cfg);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.scenes.map((s) => s.kind)).toEqual(['ingredient_assembly']);
    const steps = cfg.scenes[0]!.kind === 'ingredient_assembly' ? cfg.scenes[0]!.steps : [];
    expect(steps.every((s) => s.layers.length === 0)).toBe(true);
  });

  it('không dữ liệu phụ: chương tên món, chương giao hàng, chương kết', () => {
    const steps = (reelFallbackConfig(product({ name: 'Rau muống' })).scenes[0] as { steps: { title: string; body: string }[] }).steps;
    expect(steps).toHaveLength(3);
    expect(steps[0]!.body).toContain('Rau muống');
    expect(steps[1]!.title).toBe('Giao đến tận nhà');
    expect(steps[2]!.body).toContain('Tubu Tree gửi bạn Rau muống');
  });

  it('chứng nhận và mô tả chỉ vào khi dữ liệu sản phẩm có; chứng nhận lấy đúng chữ của dữ liệu', () => {
    const steps = (reelFallbackConfig(product({ certifications: ['VietGAP', ' '], shortDesc: 'Rau tươi trong ngày.' })).scenes[0] as { steps: { title: string; body: string }[] }).steps;
    expect(steps.map((s) => s.title)).toEqual(['Món Tubu Tree chọn', 'Ghi trên sản phẩm', 'Giới thiệu ngắn', 'An lành cho cả nhà']);
    expect(steps[1]!.body).toBe('Chứng nhận ghi trên sản phẩm: VietGAP.');
    expect(steps[2]!.body).toBe('Rau tươi trong ngày.');
  });

  it('không tuyên bố cần giấy tờ khi dữ liệu không có: vùng miền, chứng nhận, thu hoạch, độ giòn ngọt', () => {
    const BANNED = /đà lạt|vietgap|globalgap|hữu cơ|organic|thu hoạch|sáng sớm|giòn|ngọt|xuất xứ|nhập khẩu|tự nhiên 100|an toàn|tươi/i;
    for (const line of textOf(reelFallbackConfig(product({ name: 'Rau cải' })))) expect(line, line).not.toMatch(BANNED);
  });

  it('chữ không vượt trần của parseStoryConfig kể cả tên rất dài và nhiều chứng nhận', () => {
    const cfg = reelFallbackConfig(product({ name: 'N'.repeat(300), brand: 'B'.repeat(300), certifications: ['C'.repeat(99), 'D'.repeat(99), 'E'.repeat(99), 'F'], shortDesc: 'M'.repeat(500) }));
    expect(parseStoryConfig(cfg).ok).toBe(true);
    for (const sc of cfg.scenes) {
      if (sc.kind !== 'ingredient_assembly') continue;
      expect(sc.steps.length).toBeLessThanOrEqual(STORY_LIMITS.maxSteps);
      for (const st of sc.steps) {
        expect(st.title.length).toBeLessThanOrEqual(STORY_LIMITS.maxLabel);
        expect(st.body.length).toBeLessThanOrEqual(STORY_LIMITS.maxBody);
      }
    }
  });
});

describe('resolveReelStoryConfig', () => {
  const twoVariations = [
    { id: 'v1', name: '500g' },
    { id: 'v2', name: '1kg' },
  ];

  it('món chỉ có phân loại (kịch bản tự sinh chỉ có vòng cung) dùng kịch bản dự phòng, không còn vòng cung', () => {
    const cfg = resolveReelStoryConfig(product({ variations: twoVariations }));
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
    expect(cfg.scenes.some((s) => s.kind === 'ingredient_assembly')).toBe(true);
    expect(storyView(cfg, { reducedMotion: false }).steps.length).toBeGreaterThan(0);
  });

  it('món có thành phần giữ kịch bản giàu của trang chi tiết (nhiều lớp nguyên liệu) nhưng bỏ vòng cung', () => {
    const cfg = resolveReelStoryConfig(product({ variations: twoVariations, ingredients: [{ name: 'Mật ong' }, { name: 'Gừng' }] }));
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
    const view = storyView(cfg, { reducedMotion: false });
    expect(view.steps.some((s) => s.layers.length > 0)).toBe(true);
    expect(view.hud?.points.length).toBeGreaterThan(0);
  });

  it('món có preset theo slug giữ preset, bỏ vòng cung', () => {
    const cfg = resolveReelStoryConfig(product({ slug: 'dau-goi-buoi-po-lang', name: 'Dầu gội bưởi Pơ Lang', variations: twoVariations }));
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
    expect(storyView(cfg, { reducedMotion: false }).steps.some((s) => s.layers.length > 0)).toBe(true);
  });

  it('luôn trả cấu hình hợp lệ, kể cả cấu hình lưu hỏng', () => {
    const cfg = resolveReelStoryConfig(product({ storyConfig: { version: 99, junk: true } }));
    expect(parseStoryConfig(cfg).ok).toBe(true);
  });
});

describe('reelDisabled', () => {
  it('chỉ true khi cấu hình đã lưu tắt hẳn (enabled: false)', () => {
    expect(reelDisabled({ storyConfig: { version: 1, enabled: false, scenes: [] } })).toBe(true);
    expect(reelDisabled({ storyConfig: { version: 1, enabled: true, scenes: [] } })).toBe(false);
    expect(reelDisabled({ storyConfig: null })).toBe(false);
    expect(reelDisabled({})).toBe(false);
    expect(reelDisabled({ storyConfig: 'x' })).toBe(false);
  });
});

describe('trạng thái đã xem', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('ghi rồi đọc lại đúng slug, không sửa bộ cũ', () => {
    const st = memory();
    const empty = readReelSeen(st);
    expect(empty.size).toBe(0);
    const one = markReelSeen(st, empty, 'a');
    const two = markReelSeen(st, one, 'b');
    expect(empty.size).toBe(0);
    expect([...readReelSeen(st)]).toEqual(['a', 'b']);
    expect(two.has('a')).toBe(true);
    expect(JSON.parse(st.m.get(REEL_SEEN_KEY)!)).toEqual(['a', 'b']);
  });

  it('storage thiếu, JSON hỏng, giá trị lạ hoặc ghi lỗi: không ném, vẫn nhớ trong phiên', () => {
    expect(readReelSeen(null).size).toBe(0);
    expect(readReelSeen({ getItem: () => '{không phải json', setItem: () => undefined }).size).toBe(0);
    expect([...readReelSeen({ getItem: () => JSON.stringify(['a', 3, null, 'b']), setItem: () => undefined })]).toEqual(['a', 'b']);
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(markReelSeen(throwing, new Set(), 'z').has('z')).toBe(true);
    expect(markReelSeen(null, new Set(), 'z').has('z')).toBe(true);
  });

  it('chỉ giữ 64 slug gần nhất', () => {
    const st = memory();
    let seen = new Set<string>();
    for (let i = 0; i < 70; i += 1) seen = markReelSeen(st, seen, `s${i}`);
    const stored = readReelSeen(st);
    expect(stored.size).toBe(64);
    expect(stored.has('s69')).toBe(true);
    expect(stored.has('s0')).toBe(false);
  });
});

describe('reelNeighbor', () => {
  const slugs = ['a', 'b', 'c'];
  it('kế và trước, null ở hai đầu và khi slug lạ', () => {
    expect(reelNeighbor(slugs, 'a', 1)).toBe('b');
    expect(reelNeighbor(slugs, 'c', 1)).toBeNull();
    expect(reelNeighbor(slugs, 'a', -1)).toBeNull();
    expect(reelNeighbor(slugs, 'b', -1)).toBe('a');
    expect(reelNeighbor(slugs, 'x', 1)).toBeNull();
  });
});
