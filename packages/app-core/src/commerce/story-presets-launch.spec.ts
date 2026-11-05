import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS, type ProductStoryConfig } from '@tubutree/shared-types';
import { resolveStoryConfig } from './product-story';
import { STORY_PRESETS } from './story-presets';
import { baseSlug, findStoryPreset, LAUNCH_STORY_PRESETS } from './story-presets-launch';
import { STORY_SPRITES } from './story-sprites';

/** Slug thật của bốn sản phẩm đợt đầu và sản phẩm dự phòng trên PROD (docs/product-story-Rollout-Plan.md mục 4). */
const PROD_SLUGS = {
  sokfarm: 'duong-hoa-dua-sokfarm-d6c685',
  bhnong: 'banh-mam-hat-yen-mach-bh-nong-ec5325',
  polang: 'dau-rua-mat-po-lang-100ml-55ml-8478ee',
  fuwa3e: 'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
  durica: 'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi-2c9db2',
} as const;

const textOf = (cfg: ProductStoryConfig): string[] =>
  cfg.scenes.flatMap((sc) => {
    if (sc.kind === 'ingredient_assembly') return sc.steps.flatMap((st) => [st.title, st.body, ...st.layers.map((l) => l.label)]);
    if (sc.kind === 'hud_callouts') return [sc.closing, ...sc.points.map((p) => p.label)];
    return [];
  });

describe('LAUNCH_STORY_PRESETS', () => {
  it('đúng năm sản phẩm đợt đầu, khoá theo slug gốc (không hậu tố băm)', () => {
    expect(Object.keys(LAUNCH_STORY_PRESETS).sort()).toEqual(Object.values(PROD_SLUGS).map(baseSlug).sort());
    for (const key of Object.keys(LAUNCH_STORY_PRESETS)) expect(baseSlug(key), key).toBe(key);
  });

  it.each(Object.keys(LAUNCH_STORY_PRESETS))('%s: qua parseStoryConfig, 3 bước có hình, 3–4 điểm chỉ, bật sẵn, không có vòng cung', (key) => {
    const cfg = LAUNCH_STORY_PRESETS[key]!;
    const r = parseStoryConfig(cfg);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const assembly = cfg.scenes.find((s) => s.kind === 'ingredient_assembly');
    const hud = cfg.scenes.find((s) => s.kind === 'hud_callouts');
    if (assembly?.kind !== 'ingredient_assembly' || hud?.kind !== 'hud_callouts') throw new Error('thiếu cảnh');
    expect(assembly.steps).toHaveLength(3);
    for (const st of assembly.steps) {
      expect(st.layers.length, `${key}: ${st.title}`).toBeGreaterThan(0);
      for (const l of st.layers) expect(STORY_SPRITES, `${key}: ${l.spriteId}`).toHaveProperty(l.spriteId ?? '');
    }
    expect(hud.points.length).toBeGreaterThanOrEqual(3);
    expect(hud.points.length).toBeLessThanOrEqual(STORY_LIMITS.maxHudPoints);
    expect(cfg.enabled).toBe(true);
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
  });

  it('id lớp không trùng nhau trong toàn bộ preset đợt đầu và không trùng id của preset seed', () => {
    const ids = [...Object.values(LAUNCH_STORY_PRESETS), ...Object.values(STORY_PRESETS)].flatMap((c) =>
      c.scenes.flatMap((s) => (s.kind === 'ingredient_assembly' ? s.steps.flatMap((st) => st.layers.map((l) => l.id)) : [])),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('không có tuyên bố cần giấy tờ: vùng miền, hữu cơ, vegan, diệt khuẩn, calo, công dụng sức khoẻ, so sánh hơn', () => {
    const BANNED =
      /trà vinh|bến tre|quảng nam|đắk lắk|đắc lắc|thanh hoá|thanh hóa|tây nguyên|hữu cơ|organic|low ?gi|vegan|thuần chay|diệt khuẩn|kháng khuẩn|calo|protein|canxi|chất xơ|lành tính|an toàn|không hoá chất|không hóa chất|chữa|điều trị|mọc tóc|giảm |tốt nhất|số 1|số một|thượng hạng|tự nhiên 100|sấy thăng hoa|thăng hoa/i;
    for (const [key, cfg] of Object.entries(LAUNCH_STORY_PRESETS)) {
      for (const line of textOf(cfg)) expect(line, `${key}: "${line}"`).not.toMatch(BANNED);
    }
  });

  it('con số chỉ gồm ba giá trị in trên bao bì: 100% nguyên chất (Sokfarm), 1000 lớp (BH.NONG), hộp 10 gói (DURICA)', () => {
    const allowed = new Set(['100', '1000', '10']);
    for (const [key, cfg] of Object.entries(LAUNCH_STORY_PRESETS)) {
      for (const line of textOf(cfg)) for (const n of line.match(/\d+/g) ?? []) expect(allowed.has(n), `${key}: "${line}" có số ${n}`).toBe(true);
    }
  });

  it('nhãn hình không lộ tên sprite gần đúng thành nguyên liệu khác (mật ong, Arabica, granola)', () => {
    for (const [key, cfg] of Object.entries(LAUNCH_STORY_PRESETS)) {
      for (const sc of cfg.scenes) {
        if (sc.kind !== 'ingredient_assembly') continue;
        for (const st of sc.steps) for (const l of st.layers) expect(l.label, `${key}`).not.toMatch(/mật ong|arabica|granola|bơ hạt mỡ/i);
      }
    }
  });

  it('chữ vừa trần độ dài của parseStoryConfig (không bị cắt âm thầm)', () => {
    for (const [key, cfg] of Object.entries(LAUNCH_STORY_PRESETS)) {
      const parsed = parseStoryConfig(cfg);
      if (!parsed.ok) throw new Error(`${key}: ${parsed.error}`);
      expect(textOf(parsed.value), key).toEqual(textOf(cfg));
    }
  });
});

describe('findStoryPreset', () => {
  it('slug PROD có hậu tố băm khớp bảng theo slug gốc; slug gốc khớp thẳng', () => {
    for (const slug of Object.values(PROD_SLUGS)) {
      expect(findStoryPreset(slug), slug).toBe(LAUNCH_STORY_PRESETS[baseSlug(slug)]);
      expect(findStoryPreset(baseSlug(slug)), slug).toBeDefined();
    }
  });

  it('mẫu seed vẫn khớp đúng slug seed', () => {
    expect(findStoryPreset('dau-goi-buoi-po-lang')).toBe(STORY_PRESETS['dau-goi-buoi-po-lang']);
  });

  it('không khớp mờ: sản phẩm khác cùng dòng, hậu tố không phải hex, tiền tố, slug rỗng, khoá nguyên mẫu đều không nhận kịch bản', () => {
    for (const slug of [
      'mat-hoa-dua-sokfarm-d6c685',
      'duong-hoa-dua-sokfarm-xyz123',
      'duong-hoa-dua-sokfarm-d6c685-moi',
      'duong-hoa-dua',
      'dau-goi-thao-duoc-po-lang-300g-77bb42',
      'dau-goi-buoi-po-lang-d6c685',
      '',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(findStoryPreset(slug), slug).toBeUndefined();
    }
  });

  it('baseSlug chỉ bỏ đúng một hậu tố hex sáu ký tự ở cuối', () => {
    expect(baseSlug('duong-hoa-dua-sokfarm-d6c685')).toBe('duong-hoa-dua-sokfarm');
    expect(baseSlug('duong-hoa-dua-sokfarm')).toBe('duong-hoa-dua-sokfarm');
    expect(baseSlug('san-pham-abcdef-123456')).toBe('san-pham-abcdef');
  });
});

describe('resolveStoryConfig với sản phẩm PROD đợt đầu', () => {
  const variations = [
    { id: 'v1', name: '300g' },
    { id: 'v2', name: '1KG' },
    { id: 'v3', name: '5KG' },
  ];
  const sokfarm = { slug: PROD_SLUGS.sokfarm, name: 'Đường hoa dừa SOKFARM', brand: 'Sokfarm', variations, ingredients: null, storyConfig: null };

  it('chưa lưu gì: dùng preset theo slug gốc, chèn vòng cung từ phân loại thật lên đầu', () => {
    const cfg = resolveStoryConfig(sokfarm);
    expect(cfg?.scenes.map((s) => s.kind)).toEqual(['variant_arc', 'ingredient_assembly', 'hud_callouts']);
    const arc = cfg?.scenes[0];
    expect(arc?.kind === 'variant_arc' && arc.items.map((i) => i.variationId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('một phân loại: không có vòng cung, vẫn có lắp ghép và HUD', () => {
    const cfg = resolveStoryConfig({ ...sokfarm, slug: PROD_SLUGS.fuwa3e, variations: [{ id: 'v1', name: '3,8L' }] });
    expect(cfg?.scenes.map((s) => s.kind)).toEqual(['ingredient_assembly', 'hud_callouts']);
  });

  it('đã lưu storyConfig hợp lệ thì thắng preset; admin tắt (enabled=false) thì không vẽ gì', () => {
    const saved: ProductStoryConfig = { version: 1, enabled: true, scenes: [{ kind: 'hud_callouts', points: [{ id: 'a', xPct: 30, yPct: 30, label: 'Do admin soạn', side: 'left' }], closing: 'Kết' }] };
    expect(resolveStoryConfig({ ...sokfarm, storyConfig: saved })?.scenes).toEqual(saved.scenes);
    expect(resolveStoryConfig({ ...sokfarm, storyConfig: { ...saved, enabled: false } })).toBeNull();
  });

  it('preset đợt đầu không có ảnh tách nền nên sân khấu dùng thẻ nổi', () => {
    expect(resolveStoryConfig(sokfarm)?.cutoutUrl).toBeUndefined();
  });
});
