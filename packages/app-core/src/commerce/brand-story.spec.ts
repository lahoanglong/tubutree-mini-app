import { describe, it, expect } from 'vitest';
import { parseStoryConfig, type ProductStoryConfig } from '@tubutree/shared-types';
import { buildBrandStoryConfig, detectStoryBrand, titleScent, titleSizes } from './brand-story';
import { resolveStoryConfig } from './product-story';

// Tên và slug lấy từ catalog PROD (05/11/2026): cột brand của mọi sản phẩm là "Tubu Tree", nên nhãn chỉ nhận ra từ tên và slug.
const PROD = [
  { slug: 'duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3', name: 'Đường hoa dừa Sokfarm - Hủ thủy tinh 150g', brand: 'Tubu Tree', id: 'sokfarm' },
  { slug: 'nuoc-tuong-mat-hoa-dua-sokfarm-cham-034cc1', name: 'Nước tương mật hoa dừa SOKFARM (chấm)', brand: 'Tubu Tree', id: 'sokfarm' },
  { slug: 'mat-co-dac-sokfarm-hop-12-goi-9139b9', name: 'Mật cô đặc Sokfarm - Hộp 12 gói', brand: 'Tubu Tree', id: 'sokfarm' },
  { slug: 'sua-hat-gao-lut-nay-mam-bh-nong-lon-400g-e0cafb', name: 'Sữa hạt gạo lứt nảy mầm BH.NONG - Lon 400g', brand: 'Tubu Tree', id: 'bhnong' },
  { slug: 'xoai-say-deo-bh-nong-5f75de', name: 'Xoài sấy dẻo BH.NONG', brand: 'Tubu Tree', id: 'bhnong' },
  { slug: 'nuoc-mui-gia-po-lang-160ml-458227', name: 'Nước mùi già PƠ LANG 160ml', brand: 'Tubu Tree', id: 'polang' },
  { slug: 'dau-bo-tuoi-po-lang-30ml-10ml-40349e', name: 'Dầu bơ tươi PƠ LANG 30ml/10ml', brand: 'Tubu Tree', id: 'polang' },
  { slug: 'son-duong-bo-tuoi-po-lang-a08-b6ae3f', name: 'Son dưỡng bơ tươi PƠ LANG A08', brand: 'Tubu Tree', id: 'polang' },
  { slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Tubu Tree', id: 'fuwa3e' },
  { slug: 'nuoc-lau-da-nang-fuwa3e-500ml-cbb309', name: 'Nước lau đa năng FUWA3E 500ml', brand: 'Tubu Tree', id: 'fuwa3e' },
  { slug: 'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi-2c9db2', name: 'Cà Phê Sầu Riêng Thơm Béo DURICA Le Plateau Hộp g x 10 Gói', brand: 'Tubu Tree', id: 'durica' },
] as const;

const NOT_BRAND = [
  { slug: 'xit-tram-cho-be-pineboo-150ml-b70d1d', name: 'Xịt tràm cho bé Pineboo 150ml' },
  { slug: 'nuoc-dong-trung-ha-thao-hector-lite-db096e', name: 'Nước Đông Trùng Hạ Thảo HECTOR Lite 70ml x 10 Chai' },
  { slug: 'dau-xa-thao-duoc-visante-1314dc', name: 'Dầu Xả Thảo Dược VISANTE 500ml' },
  { slug: 'ca-phe-muoi-tui-50x16g-9fbabb', name: 'Cà phê muối túi 50x16g' },
];

describe('detectStoryBrand: nhận nhãn từ tên và slug', () => {
  it.each(PROD)('$name → $id', ({ id, ...p }) => {
    expect(detectStoryBrand(p)).toBe(id);
  });

  it('cột brand đúng nhãn cũng nhận (chính tả "Sokfram" của catalog cũ)', () => {
    expect(detectStoryBrand({ slug: 'x-1', name: 'Mật hoa dừa', brand: 'Sokfram' })).toBe('sokfarm');
    expect(detectStoryBrand({ slug: 'x-2', name: 'Bánh gạo', brand: 'BH.Nong' })).toBe('bhnong');
  });

  it('chỉ slug nhắc nhãn mà tên không nhắc thì không nhận (slug không đáng tin: "BH nóng" cũng ra bh-nong)', () => {
    expect(detectStoryBrand({ slug: 'dau-goi-po-lang-300g-77bb42', name: 'Dầu gội 300g', brand: 'Tubu Tree' })).toBeNull();
    expect(detectStoryBrand({ slug: 'banh-trang-bh-nong-gion-200g-aaaaaa', name: 'Bánh tráng BH nóng giòn 200g', brand: 'Tubu Tree' })).toBeNull();
  });

  it.each(NOT_BRAND)('không nhận nhãn khác: $name', (p) => {
    expect(detectStoryBrand(p)).toBeNull();
  });

  it('đổi tên sang nhãn khác thì theo tên, slug cũ không có vai trò', () => {
    expect(detectStoryBrand({ slug: 'dau-duong-toc-bo-ket-po-lang', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Tubu Tree' })).toBe('fuwa3e');
  });

  it('tên khớp hai nhãn (combo) thì không đoán', () => {
    expect(detectStoryBrand({ slug: 'combo-sokfarm-1', name: 'Combo Sokfarm và Fuwa3e', brand: 'Tubu Tree' })).toBeNull();
    expect(buildBrandStoryConfig({ slug: 'combo-sokfarm-1', name: 'Combo Sokfarm và Fuwa3e' })).toBeNull();
  });

  it('không khớp mờ trong từ khác (polanger, bhnongthon)', () => {
    expect(detectStoryBrand({ slug: 'polanger-1', name: 'Polanger 100ml' })).toBeNull();
    expect(detectStoryBrand({ slug: 'a-1', name: 'Sản phẩm bhnongthon' })).toBeNull();
  });
});

describe('titleSizes và titleScent: chỉ đọc thẳng từ tên', () => {
  it.each([
    ['Nước giặt hương Bạc hà Fuwa3e 3,5L', ['3,5L']],
    ['Dầu bơ tươi PƠ LANG 30ml/10ml', ['30ml', '10ml']],
    ['Mật cô đặc Sokfarm - Hộp 12 gói', ['12 gói']],
    ['Cà Phê Sầu Riêng Thơm Béo DURICA Le Plateau Hộp g x 10 Gói', ['10 gói']],
    ['Gel rửa chén cho máy Fuwa3e 2000ml', ['2000ml']],
    ['Lau đa năng Fuwa3e 2L', ['2L']],
    ['Sữa hạt gạo lứt nảy mầm BH.NONG - Lon 400g', ['400g']],
    ['Son dưỡng bơ tươi PƠ LANG A08', []],
    ['Xoài sấy dẻo BH.NONG', []],
    ['Nước giặt 500ml 500ml', ['500ml']],
    ['Combo 1ml 2ml 3ml', ['1ml', '2ml']],
    ['Combo son dưỡng PƠ LANG (1 thỏi có màu & 1 thỏi không màu)', []],
    ['Nước Đông Trùng Hạ Thảo 70ml x 10 Chai', ['70ml']],
    ['Mật ong Pơ Lang 1 lít', ['1L']],
    ['Mật ong Pơ Lang 500 gr', ['500g']],
    ['Nước rửa chén Fuwa3e 3,8L tặng 1 chai 500ml', ['3,8L']],
    ['Nước rửa chén Fuwa3e 3,8L kèm khăn 200g', ['3,8L']],
    ['Combo Fuwa3e nước giặt 500ml + nước rửa chén 200ml', ['500ml']],
  ])('quy cách "%s"', (name, want) => {
    expect(titleSizes(name)).toEqual(want);
  });

  it('tên lưu dạng NFD (dấu tách rời) vẫn đọc được "gói"', () => {
    expect(titleSizes('Mật cô đặc Sokfarm - Hộp 12 gói'.normalize('NFD'))).toEqual(['12 gói']);
  });

  it.each([
    ['Nước giặt hương Bạc hà Fuwa3e 500ml', 'Bạc hà'],
    ['Xịt thơm hương Xuân Fuwa3e 300ml', 'Xuân'],
    ['Nước giặt hương Cam Fuwa3e 100ml', 'Cam'],
    ['Nước giặt hương Bạc hà - 500ml', 'Bạc hà'],
    ['Nước giặt hương Bạc hà, 3,8L', 'Bạc hà'],
    ['Nước giặt hương Cam | 500ml', 'Cam'],
    ['Nước giặt hương Quế.', 'Quế'],
    ['NƯỚC GIẶT HƯƠNG BẠC HÀ', 'Bạc hà'],
    ['Nước lau sàn hương Sả chanh 1L', 'Sả chanh'],
    ['Nước giặt hương Một Hai Ba 500ml', null],
    ['Nước giặt hương 500ml', null],
    ['Nước rửa chén Fuwa3e 500ml', null],
    ['Dầu gội Pơ Lang không hương liệu 300ml', null],
    ['Dầu gội bồ kết hương nhu Pơ Lang', null],
    ['Sữa tắm DURICA hương thảo 500ml', null],
    ['Nước giặt không hương Cam 500ml', null],
    ['Nước giặt hương Chanh + Sả', null],
    ['Nước giặt hương Cam & Bưởi', null],
    ['Nước giặt hương Cam Bưởi', null],
  ])('hương "%s"', (name, want) => {
    expect(titleScent(name)).toBe(want);
  });
});

describe('buildBrandStoryConfig', () => {
  it('sản phẩm ngoài năm nhãn: null', () => {
    for (const p of NOT_BRAND) expect(buildBrandStoryConfig(p)).toBeNull();
  });

  it('một cảnh hud_callouts hợp lệ theo schema, điểm đầu là Thương hiệu, kèm quy cách và hương có trong tên', () => {
    const cfg = buildBrandStoryConfig({ slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml' })!;
    expect(parseStoryConfig(cfg).ok).toBe(true);
    expect(cfg.scenes).toHaveLength(1);
    const hud = cfg.scenes[0]!;
    if (hud.kind !== 'hud_callouts') throw new Error('phải là hud_callouts');
    expect(hud.points.map((p) => [p.label, p.value])).toEqual([
      ['Thương hiệu', 'Fuwa3e'],
      ['Quy cách', '500ml'],
      ['Hương', 'Bạc hà'],
    ]);
    expect(hud.closing).toBe('Fuwa3e, có tại Tubu Tree');
  });

  it('một phân loại mà tên không có quy cách lẫn hương: không dựng khối (nút Xem câu chuyện sẽ hứa nhiều hơn một dòng tên nhãn)', () => {
    expect(buildBrandStoryConfig({ slug: 'xoai-say-deo-bh-nong-5f75de', name: 'Xoài sấy dẻo BH.NONG' })).toBeNull();
    expect(buildBrandStoryConfig({ slug: 'xoai-say-deo-bh-nong-5f75de', name: 'Xoài sấy dẻo BH.NONG' }, 0)).toBeNull();
  });

  it('có từ hai phân loại: chỉ ghi Thương hiệu, không ghi quy cách và hương vì chỉ đúng với một phân loại (vòng cung cho khách đổi loại)', () => {
    const cfg = buildBrandStoryConfig({ slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml' }, 2)!;
    const hud = cfg.scenes[0]!;
    if (hud.kind !== 'hud_callouts') throw new Error('phải là hud_callouts');
    expect(hud.points.map((p) => [p.label, p.value])).toEqual([['Thương hiệu', 'Fuwa3e']]);
    expect(parseStoryConfig(cfg).ok).toBe(true);
  });

  it('mọi sản phẩm mẫu PROD ra cấu hình hợp lệ (hoặc không có khối) và chữ cố định không có tuyên bố cần giấy tờ', () => {
    const BANNED = /trà vinh|bến tre|quảng nam|đắk lắk|thanh h[oó]a|hữu cơ|organic|vegan|diệt khuẩn|kháng khuẩn|lành tính|an toàn|chữa|điều trị|tốt nhất|số 1|tự nhiên|xuất xứ|chứng nhận|nguyên liệu|dứa|enzyme/i;
    for (const p of PROD) {
      for (const count of [1, 2]) {
        const cfg = buildBrandStoryConfig(p, count);
        if (!cfg) {
          expect(count, `${p.name} một phân loại không quy cách/hương thì không có khối`).toBe(1);
          continue;
        }
        expect(parseStoryConfig(cfg).ok, p.name).toBe(true);
        for (const s of cfg.scenes) {
          if (s.kind !== 'hud_callouts') continue;
          for (const pt of s.points) expect(`${pt.label} ${s.closing}`, p.name).not.toMatch(BANNED);
        }
      }
    }
  });
});

describe('resolveStoryConfig với kịch bản cấp nhãn', () => {
  const two = [
    { id: 'v1', name: '500ml' },
    { id: 'v2', name: '3,5L' },
  ];
  const brandProduct = { slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Tubu Tree' };
  const kinds = (c: ProductStoryConfig | null) => c?.scenes.map((s) => s.kind);

  it('chưa có cấu hình, hai phân loại: vòng cung rồi điểm chỉ, điểm chỉ chỉ ghi Thương hiệu (khách đổi sang 3,5L thì "500ml" trong tên không còn đúng)', () => {
    const got = resolveStoryConfig({ ...brandProduct, variations: two });
    expect(kinds(got)).toEqual(['variant_arc', 'hud_callouts']);
    const hud = got!.scenes.find((s) => s.kind === 'hud_callouts');
    if (hud?.kind !== 'hud_callouts') throw new Error('phải có hud');
    expect(hud.points.map((p) => p.label)).toEqual(['Thương hiệu']);
  });

  it('nhãn chủ lực, một phân loại, tên không quy cách lẫn hương: không dựng gì (không có khối rỗng, không có nút Xem câu chuyện)', () => {
    expect(resolveStoryConfig({ slug: 'xoai-say-deo-bh-nong-5f75de', name: 'Xoài sấy dẻo BH.NONG', brand: 'Tubu Tree', variations: [two[0]!] })).toBeNull();
  });

  it('chưa có cấu hình, một phân loại: chỉ điểm chỉ', () => {
    expect(kinds(resolveStoryConfig({ ...brandProduct, variations: [two[0]!] }))).toEqual(['hud_callouts']);
  });

  it('cấu hình đã lưu hợp lệ luôn thắng, không bị ghi đè', () => {
    const saved: ProductStoryConfig = { version: 1, enabled: true, scenes: [{ kind: 'hud_callouts', points: [{ id: 'a', xPct: 30, yPct: 30, label: 'Riêng', side: 'left' }], closing: 'Câu riêng' }] };
    const got = resolveStoryConfig({ ...brandProduct, variations: [two[0]!], storyConfig: saved });
    expect(got).toEqual(saved);
  });

  it('admin tắt (enabled:false) thì không vẽ gì, kể cả sản phẩm của nhãn chủ lực', () => {
    const off = { version: 1, enabled: false, scenes: [{ kind: 'hud_callouts', points: [{ id: 'a', xPct: 30, yPct: 30, label: 'Riêng', side: 'left' }], closing: 'x' }] };
    expect(resolveStoryConfig({ ...brandProduct, variations: two, storyConfig: off })).toBeNull();
  });

  it('cấu hình lưu hỏng (không qua schema) thì rơi xuống kịch bản cấp nhãn', () => {
    expect(kinds(resolveStoryConfig({ ...brandProduct, variations: [two[0]!], storyConfig: { rác: true } }))).toEqual(['hud_callouts']);
  });

  it('sản phẩm có preset riêng theo slug thì dùng preset, không dùng kịch bản cấp nhãn', () => {
    const got = resolveStoryConfig({ slug: 'duong-hoa-dua-sokfarm-d6c685', name: 'Đường hoa dừa SOKFARM', variations: [two[0]!] });
    expect(kinds(got)).toContain('ingredient_assembly');
  });

  it('có thành phần thật thì kịch bản tự sinh từ thành phần thắng kịch bản cấp nhãn', () => {
    const got = resolveStoryConfig({ ...brandProduct, variations: [two[0]!], ingredients: ['Bạc hà', 'Cam'] });
    expect(kinds(got)).toContain('ingredient_assembly');
    const hud = got!.scenes.find((s) => s.kind === 'hud_callouts');
    if (hud?.kind !== 'hud_callouts') throw new Error('phải có hud');
    expect(hud.points.map((p) => p.label)).toEqual(['Bạc hà', 'Cam']);
  });

  it('sản phẩm ngoài năm nhãn không đổi: không thành phần, một phân loại thì không có gì để kể', () => {
    expect(resolveStoryConfig({ slug: 'xit-tram-cho-be-pineboo-150ml-b70d1d', name: 'Xịt tràm cho bé Pineboo 150ml', variations: [two[0]!] })).toBeNull();
  });
});
