import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS, type ProductStoryConfig } from '@tubutree/shared-types';
import { resolveStoryConfig, storyView } from './product-story';
import { STORY_PRESETS } from './story-presets';
import { baseSlug, CATALOG_STORY_PRESETS, findStoryPreset, LAUNCH_STORY_PRESETS } from './story-presets-launch';
import { STORY_SPRITES } from './story-sprites';
import { BAMBOO_CLAIMS, MEDICAL_CLAIMS, PROOF_CLAIMS } from './copy-claims-guard';
import { PROD_IN_STOCK_2026_11_12 } from './prod-catalog.fixture';

/** Slug thật của các sản phẩm chủ lực trên PROD (docs/product-story-Rollout-Plan.md mục 4 + SKU Pancake thật). */
const PROD_SLUGS = {
  sokfarm: 'duong-hoa-dua-sokfarm-d6c685',
  bhnong: 'banh-mam-hat-yen-mach-bh-nong-ec5325',
  polang: 'dau-rua-mat-po-lang-100ml-55ml-8478ee',
  polangShampoo: 'dau-goi-thao-duoc-po-lang-300g-77bb42',
  fuwa3e: 'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
  fuwa3e500: 'nuoc-rua-chen-fuwa3e-500ml-185d77',
  fuwa3e100: 'nuoc-rua-chen-fuwa3e-100ml-c1337b',
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

  it.each(Object.keys(LAUNCH_STORY_PRESETS))('%s: qua parseStoryConfig, 3 bước, ít nhất một bước có hình khớp, 3–4 điểm chỉ, bật sẵn, không có vòng cung', (key) => {
    const cfg = LAUNCH_STORY_PRESETS[key]!;
    const r = parseStoryConfig(cfg);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const assembly = cfg.scenes.find((s) => s.kind === 'ingredient_assembly');
    const hud = cfg.scenes.find((s) => s.kind === 'hud_callouts');
    if (assembly?.kind !== 'ingredient_assembly' || hud?.kind !== 'hud_callouts') throw new Error('thiếu cảnh');
    expect(assembly.steps).toHaveLength(3);
    expect(assembly.steps.some((st) => st.layers.length > 0), `${key}: không bước nào có hình`).toBe(true);
    for (const st of assembly.steps) {
      for (const l of st.layers) expect(STORY_SPRITES, `${key}: ${l.spriteId}`).toHaveProperty(l.spriteId ?? '');
    }
    expect(hud.points.length).toBeGreaterThanOrEqual(3);
    expect(hud.points.length).toBeLessThanOrEqual(STORY_LIMITS.maxHudPoints);
    expect(cfg.enabled).toBe(true);
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
  });

  it('id lớp không trùng nhau trong toàn bộ preset đợt đầu và không trùng id của preset seed', () => {
    const ids = [...Object.values(LAUNCH_STORY_PRESETS), ...Object.values(CATALOG_STORY_PRESETS), ...Object.values(STORY_PRESETS)].flatMap((c) =>
      c.scenes.flatMap((s) => (s.kind === 'ingredient_assembly' ? s.steps.flatMap((st) => st.layers.map((l) => l.id)) : [])),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('không có tuyên bố cần giấy tờ: vùng miền, hữu cơ, vegan, diệt khuẩn, calo, công dụng sức khoẻ, so sánh hơn', () => {
    const BANNED =
      /trà vinh|bến tre|quảng nam|đắk lắk|đắc lắc|thanh hoá|thanh hóa|tây nguyên|hữu cơ|organic|low ?gi|vegan|thuần chay|diệt khuẩn|kháng khuẩn|calo|protein|canxi|chất xơ|lành tính|an toàn|không hoá chất|không hóa chất|chữa|điều trị|mọc tóc|giảm |tốt nhất|số 1|số một|thượng hạng|tự nhiên 100|sấy thăng hoa|thăng hoa|đài loan|việt nam|nhập khẩu|xuất xứ|chứng nhận|tiêu chuẩn|sản xuất|thực vật|nguyên liệu|tinh khiết|không đường|không chất bảo quản|thanh lọc|detox|trẻ hoá|trẻ hóa|làm trắng|khử mùi|dưỡng ẩm|da |tóc/i;
    for (const [key, cfg] of Object.entries(LAUNCH_STORY_PRESETS)) {
      for (const line of textOf(cfg)) expect(line, `${key}: "${line}"`).not.toMatch(BANNED);
    }
  });

  it('con số chỉ gồm giá trị có trong tên hoặc in trên bao bì: 100% / 100ml, 300g, 500ml, 1000 lớp, can 3,8L, hộp 10 gói', () => {
    const allowed = new Set(['100', '300', '500', '1000', '3', '8', '10']);
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

  it('mẫu seed khớp cả slug gốc lẫn slug đồng bộ Pancake có hậu tố hex 6–8 ký tự (hoa/thường, khoảng trắng thừa)', () => {
    expect(findStoryPreset('dau-goi-buoi-po-lang')).toBe(STORY_PRESETS['dau-goi-buoi-po-lang']);
    expect(findStoryPreset('dau-goi-buoi-po-lang-d6c685')).toBe(STORY_PRESETS['dau-goi-buoi-po-lang']);
    expect(findStoryPreset('  DAU-GOI-BUOI-PO-LANG-A1B2C3D4  ')).toBe(STORY_PRESETS['dau-goi-buoi-po-lang']);
    expect(findStoryPreset('nuoc-rua-chen-fuwa3e-ef3979')).toBe(STORY_PRESETS['nuoc-rua-chen-fuwa3e']);
    expect(findStoryPreset('duong-hoa-dua-sokfarm-D6C685')).toBe(LAUNCH_STORY_PRESETS['duong-hoa-dua-sokfarm']);
    expect(findStoryPreset('dau-goi-thao-duoc-po-lang-300g-77bb42')).toBe(LAUNCH_STORY_PRESETS['dau-goi-thao-duoc-po-lang-300g']);
  });

  it('không khớp mờ: sản phẩm khác cùng dòng, hậu tố không phải hex hoặc quá ngắn/dài, tiền tố, slug rỗng, khoá nguyên mẫu đều không nhận kịch bản', () => {
    for (const slug of [
      'mat-hoa-dua-sokfarm-d6c685',
      'duong-hoa-dua-sokfarm-xyz123',
      'duong-hoa-dua-sokfarm-12345',
      'duong-hoa-dua-sokfarm-123456789',
      'duong-hoa-dua-sokfarm-d6c685-moi',
      'duong-hoa-dua',
      '',
      '   ',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(findStoryPreset(slug), slug).toBeUndefined();
    }
  });

  it('baseSlug chuẩn hoá chữ thường và chỉ bỏ đúng một hậu tố hex 6–8 ký tự ở cuối', () => {
    expect(baseSlug('duong-hoa-dua-sokfarm-d6c685')).toBe('duong-hoa-dua-sokfarm');
    expect(baseSlug('  Dau-Goi-Thao-Duoc-Po-Lang-300g-77BB42 ')).toBe('dau-goi-thao-duoc-po-lang-300g');
    expect(baseSlug('nuoc-rua-chen-fuwa3e-a1b2c3d4')).toBe('nuoc-rua-chen-fuwa3e');
    expect(baseSlug('duong-hoa-dua-sokfarm')).toBe('duong-hoa-dua-sokfarm');
    expect(baseSlug('san-pham-abcdef-123456')).toBe('san-pham-abcdef');
    expect(baseSlug('san-pham-12345')).toBe('san-pham-12345');
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
    const cfg = resolveStoryConfig(sokfarm);
    expect(cfg?.cutoutUrl).toBeUndefined();
    if (!cfg) throw new Error('thiếu cấu hình');
    expect(storyView(cfg, { reducedMotion: false }).frame).toBe('floating-card');
    expect(storyView(cfg, { reducedMotion: true }).frame).toBe('floating-card');
  });

  it('preset tắt (enabled=false) thì không vẽ gì, kể cả khi sản phẩm khớp slug', () => {
    const spy = { ...LAUNCH_STORY_PRESETS['duong-hoa-dua-sokfarm']!, enabled: false };
    const original = LAUNCH_STORY_PRESETS['duong-hoa-dua-sokfarm']!;
    LAUNCH_STORY_PRESETS['duong-hoa-dua-sokfarm'] = spy;
    try {
      expect(resolveStoryConfig(sokfarm)).toBeNull();
    } finally {
      LAUNCH_STORY_PRESETS['duong-hoa-dua-sokfarm'] = original;
    }
  });
});

/** Số trong một chuỗi chữ, bỏ dấu phẩy thập phân: "3,8L" → ["3", "8"]. */
const digitsOf = (s: string): string[] => s.match(/\d+/g) ?? [];
const SIZE_IN_NAME = /(\d+(?:,\d+)?)\s?(ml|l|kg)\b/i;
// Mỗi SKU của hai nhãn trong catalog PROD đúng một phân loại: dùng một phân loại để đi qua nhánh "một phân loại" của resolveStoryConfig.
const ONE_VARIATION = [{ id: 'v1', name: 'Mặc định' }];
const inCatalog = (re: RegExp) => PROD_IN_STOCK_2026_11_12.filter((r) => re.test(r.slug));
const PINEBOO = inCatalog(/-pineboo-/);
const FUWA3E = inCatalog(/-fuwa3e-/);
const asProduct = (r: { slug: string; name: string }) => ({ slug: r.slug, name: r.name, brand: 'Tubu Tree', variations: ONE_VARIATION, ingredients: null, storyConfig: null });
const hudOf = (cfg: ProductStoryConfig | null) => {
  const hud = cfg?.scenes.find((s) => s.kind === 'hud_callouts');
  if (hud?.kind !== 'hud_callouts') throw new Error('thiếu cảnh HUD');
  return hud;
};

describe('CATALOG_STORY_PRESETS: sản phẩm Pineboo và Fuwa3e trong catalog PROD 12/11/2026', () => {
  it('fixture đủ: 6 Pineboo và 43 Fuwa3e còn hàng', () => {
    expect(PINEBOO).toHaveLength(6);
    expect(FUWA3E).toHaveLength(43);
  });

  it('khoá là slug gốc, mỗi khoá ứng đúng một SKU trong fixture, không trùng bảng đợt đầu', () => {
    const catalogBases = new Set([...PINEBOO, ...FUWA3E].map((r) => baseSlug(r.slug)));
    for (const key of Object.keys(CATALOG_STORY_PRESETS)) {
      expect(baseSlug(key), key).toBe(key);
      expect(catalogBases.has(key), `${key}: không có trong fixture`).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(LAUNCH_STORY_PRESETS, key), `${key}: trùng bảng đợt đầu`).toBe(false);
    }
  });

  it('6/6 Pineboo và mọi Fuwa3e còn hàng (trừ muối rửa chén cho máy) có kịch bản riêng; 3 SKU rửa chén đã có ở bảng đợt đầu', () => {
    const missing: string[] = [];
    for (const r of [...PINEBOO, ...FUWA3E]) {
      if (findStoryPreset(r.slug) === undefined) missing.push(baseSlug(r.slug));
    }
    expect(missing.sort()).toEqual(['muoi-rua-chen-cho-may-fuwa3e-2kg']);
    expect(Object.keys(CATALOG_STORY_PRESETS)).toHaveLength(45);
    for (const r of PINEBOO) expect(CATALOG_STORY_PRESETS[baseSlug(r.slug)], r.slug).toBeDefined();
  });

  it('49/49 sản phẩm còn hàng của hai nhãn (6 Pineboo, 43 Fuwa3e) resolve ra ProductStory hợp lệ, đủ cảnh; muối rửa chén nhận kịch bản cấp nhãn', () => {
    for (const r of [...PINEBOO, ...FUWA3E]) {
      const cfg = resolveStoryConfig(asProduct(r));
      expect(cfg, r.slug).not.toBeNull();
      const parsed = parseStoryConfig(cfg);
      expect(parsed.ok, `${r.slug}: ${parsed.ok ? '' : parsed.error}`).toBe(true);
      expect(cfg!.enabled, r.slug).toBe(true);
      expect(cfg!.scenes.some((s) => s.kind === 'hud_callouts'), r.slug).toBe(true);
    }
    const salt = FUWA3E.find((r) => /muoi-rua-chen/.test(r.slug))!;
    expect(findStoryPreset(salt.slug)).toBeUndefined();
    expect(hudOf(resolveStoryConfig(asProduct(salt))).points.map((p) => p.value ?? p.label)).toEqual(['Fuwa3e', '2kg']);
  });

  it.each(Object.keys(CATALOG_STORY_PRESETS))('%s: qua parseStoryConfig, 3 bước, có hình, 3–4 điểm chỉ, bật sẵn, không vòng cung, hình có thật', (key) => {
    const cfg = CATALOG_STORY_PRESETS[key]!;
    const r = parseStoryConfig(cfg);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const assembly = cfg.scenes.find((s) => s.kind === 'ingredient_assembly');
    if (assembly?.kind !== 'ingredient_assembly') throw new Error('thiếu cảnh lắp ghép');
    expect(assembly.steps).toHaveLength(3);
    expect(assembly.steps.some((st) => st.layers.length > 0), `${key}: không bước nào có hình`).toBe(true);
    for (const st of assembly.steps) for (const l of st.layers) expect(STORY_SPRITES, `${key}: ${l.spriteId}`).toHaveProperty(l.spriteId ?? '');
    const hud = hudOf(cfg);
    expect(hud.points.length).toBeGreaterThanOrEqual(3);
    expect(hud.points.length).toBeLessThanOrEqual(STORY_LIMITS.maxHudPoints);
    expect(cfg.enabled).toBe(true);
    expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
    if (!r.ok) throw new Error(`${key}: ${r.error}`);
    expect(textOf(r.value), key).toEqual(textOf(cfg));
  });

  it('không có tuyên bố y tế, giấy tờ, chứng nhận, tre/tăm bông/khăn giấy trong chữ của mọi kịch bản', () => {
    for (const [key, cfg] of Object.entries(CATALOG_STORY_PRESETS)) {
      for (const line of textOf(cfg)) {
        expect(line, `${key}: "${line}"`).not.toMatch(MEDICAL_CLAIMS);
        expect(line, `${key}: "${line}"`).not.toMatch(PROOF_CLAIMS);
        expect(line, `${key}: "${line}"`).not.toMatch(BAMBOO_CLAIMS);
      }
    }
  });

  it('con số chỉ gồm chữ số có trong tên SKU (quy cách), không thêm số mới', () => {
    for (const r of [...PINEBOO, ...FUWA3E]) {
      const cfg = CATALOG_STORY_PRESETS[baseSlug(r.slug)];
      if (!cfg) continue;
      const allowed = new Set(digitsOf(r.name));
      for (const line of textOf(cfg)) for (const n of digitsOf(line)) expect(allowed.has(n), `${r.slug}: "${line}" có số ${n}`).toBe(true);
    }
  });

  it('quy cách trong kịch bản đúng quy cách trong tên SKU, và loại hàng Fuwa3e là đoạn của tên SKU', () => {
    for (const r of [...PINEBOO, ...FUWA3E]) {
      const cfg = CATALOG_STORY_PRESETS[baseSlug(r.slug)];
      if (!cfg) continue;
      const size = r.name.match(SIZE_IN_NAME)![0].replace(/\s/g, '');
      const lines = textOf(cfg);
      expect(lines.some((l) => l.includes(`Quy cách ${size}`)), `${r.slug}: thiếu "Quy cách ${size}"`).toBe(true);
      if (FUWA3E.includes(r)) {
        const assembly = cfg.scenes.find((s) => s.kind === 'ingredient_assembly');
        const title = assembly?.kind === 'ingredient_assembly' ? assembly.steps[1]!.title : '';
        expect(r.name.toLowerCase(), `${r.slug}: loại hàng "${title}" không có trong tên`).toContain(title.toLowerCase());
      }
    }
  });

  it('Pineboo: cả sáu kịch bản nói eco-enzyme từ vỏ dứa (đúng chữ bao bì), HUD có tên loại hàng, quy cách và lời kết nêu nhãn', () => {
    for (const r of PINEBOO) {
      const cfg = CATALOG_STORY_PRESETS[baseSlug(r.slug)]!;
      const lines = textOf(cfg).join(' | ').toLowerCase();
      expect(lines, r.slug).toContain('eco-enzyme');
      expect(lines, r.slug).toContain('vỏ dứa');
      const hud = hudOf(cfg);
      expect(hud.closing, r.slug).toBe('Pineboo, eco-enzyme từ vỏ dứa cho bé');
      expect(hud.points.map((p) => p.label)).toContain(`Quy cách ${r.name.match(SIZE_IN_NAME)![0].replace(/\s/g, '')}`);
    }
  });

  it('Fuwa3e: chỉ nói "vỏ dứa" ở bậc bao bì có ghi, "Enzyme Cleaner" ở bậc chỉ thấy logo, và SKU chưa có ảnh bao bì chỉ nói thương hiệu', () => {
    const NO_PACK_IMAGE = [
      'lau-noi-that-o-to-fuwa3e-300ml',
      'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l',
      'xit-khu-mui-o-to-fuwa3e-150ml',
      'xit-thom-huong-xuan-fuwa3e-300ml',
    ];
    const all = Object.entries(CATALOG_STORY_PRESETS).filter(([k]) => k.includes('fuwa3e'));
    const joined = (k: string) => textOf(CATALOG_STORY_PRESETS[k]!).join(' ');
    const dua = all.filter(([k]) => joined(k).includes('vỏ dứa'));
    const cleaner = all.filter(([k]) => !joined(k).includes('vỏ dứa') && joined(k).includes('Enzyme Cleaner'));
    const brandOnly = all.filter(([k]) => !joined(k).includes('vỏ dứa') && !joined(k).includes('Enzyme Cleaner'));
    expect(dua.length + cleaner.length + brandOnly.length).toBe(39);
    expect(brandOnly.map(([k]) => k).sort()).toEqual(NO_PACK_IMAGE);
    expect(cleaner.map(([k]) => k).sort()).toEqual([
      'gel-rua-chen-cho-may-fuwa3e-500ml',
      'nuoc-giat-huong-bac-ha-fuwa3e-500ml',
      'nuoc-giat-huong-cam-fuwa3e-3-5l',
      'nuoc-ho-tro-xa-lam-bong-fuwa3e-500ml',
      'nuoc-lau-ban-tho-fuwa3e-500ml',
      'nuoc-lau-san-sa-chanh-fuwa3e-1l',
    ]);
    for (const [k] of brandOnly) expect(joined(k), k).not.toMatch(/enzyme|bao bì ghi/i);
  });

  it('hương chỉ xuất hiện khi tên SKU hoặc nhãn đúng loại hàng đó ghi; SKU không hương thì không có chữ "Hương"', () => {
    for (const [k, cfg] of Object.entries(CATALOG_STORY_PRESETS)) {
      const hasScent = textOf(cfg).some((l) => /^Hương /.test(l));
      if (hasScent) expect(k, k).toMatch(/bac-ha|cam|sa-chanh|que|xuan|da-nang|gel|nuoc-rua-tay|do-lot|ban-tho|ve-sinh-nha-tam-va-toilet-fuwa3e-2l/);
      else expect(textOf(cfg).some((l) => /(?<!\p{L})hương/iu.test(l)), k).toBe(false);
    }
  });

  it('nhãn hình khớp sprite thật: Vỏ dứa, Sả chanh, Hương nhu, Tràm, Giọt nước (không đặt nhãn khác lên hình khác vật)', () => {
    const allowed = new Set(['Vỏ dứa', 'Sả chanh', 'Hương nhu', 'Tràm', 'Giọt nước']);
    for (const [k, cfg] of Object.entries(CATALOG_STORY_PRESETS)) {
      for (const sc of cfg.scenes) {
        if (sc.kind !== 'ingredient_assembly') continue;
        for (const st of sc.steps) for (const l of st.layers) expect(allowed.has(l.label), `${k}: nhãn hình "${l.label}"`).toBe(true);
      }
    }
  });

  it('khoá nguyên mẫu, hậu tố lạ hay SKU khác cỡ vẫn không nhận kịch bản (không khớp mờ)', () => {
    for (const slug of ['nuoc-giat-huong-cam-fuwa3e-1l-a0090c', 'xit-tram-cho-be-pineboo-100ml-b70d1d', 'xit-tram-cho-be-pineboo-150ml-zzzzzz', 'bot-rua-tay-cho-be-pineboo-300ml-moi']) {
      expect(findStoryPreset(slug), slug).toBeUndefined();
    }
    expect(findStoryPreset('xit-tram-cho-be-pineboo-150ml-b70d1d')).toBe(CATALOG_STORY_PRESETS['xit-tram-cho-be-pineboo-150ml']);
    expect(findStoryPreset('  XIT-TRAM-CHO-BE-PINEBOO-150ML-B70D1D ')).toBe(CATALOG_STORY_PRESETS['xit-tram-cho-be-pineboo-150ml']);
  });
});
