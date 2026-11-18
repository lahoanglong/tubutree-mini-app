import { describe, expect, it } from 'vitest';
import { PROD_VARIATIONS_2026_11_18 } from './prod-variations.fixture';
import { parseNetAmount, unitPriceView, variationUnitPrices, type UnitPriceVariation } from './unit-price';

const amount = (variationName: string, productName = '') => {
  const a = parseNetAmount(variationName, productName);
  return a ? `${a.qty}${a.unit}` : null;
};

/**
 * Kết quả đã soát tay từng dòng trên ảnh chụp PROD 18/11/2026 (111 sản phẩm): slug, lượng đọc được của từng phân loại theo thứ tự API, dòng dưới giá
 * khi chọn phân loại đầu. null = không đọc (cả sản phẩm không hiện giá theo đơn vị). Đổi bộ đọc mà một dòng lệch thì phải soát lại tay rồi mới sửa bảng.
 */
const REVIEWED: ReadonlyArray<[slug: string, amounts: (string | null)[], line: string | null]> = [
  ["xit-tram-cho-be-pineboo-150ml-b70d1d", ["150ml"], "≈ 123.300đ / 100ml"],
  ["bot-rua-tay-cho-be-pineboo-300ml-de31c8", ["300ml"], "≈ 29.000đ / 100ml"],
  ["bot-tam-goi-cho-be-pineboo-500ml-47e6e4", ["500ml"], "≈ 39.000đ / 100ml"],
  ["nuoc-giat-cho-be-pineboo-2-1l-22a73c", ["2100ml"], "≈ 13.600đ / 100ml"],
  ["nuoc-giat-cho-be-pineboo-500ml-3952e8", ["500ml"], "≈ 19.600đ / 100ml"],
  ["bot-rua-binh-sua-cho-be-pineboo-500ml-91e8c5", ["500ml"], "≈ 29.600đ / 100ml"],
  ["lau-noi-that-o-to-fuwa3e-300ml-b202d9", ["300ml"], "≈ 41.700đ / 100ml"],
  ["refill-nuoc-lau-san-que-fuwa3e-10l-fe82e8", ["10000ml"], "≈ 7.900đ / 100ml"],
  ["nuoc-lau-san-sa-chanh-fuwa3e-100ml-d10bec", ["100ml"], "≈ 17.000đ / 100ml"],
  ["nuoc-ngam-rua-thuc-pham-fuwa3e-100ml-8b4cd8", ["100ml"], "≈ 16.000đ / 100ml"],
  ["ve-sinh-nha-tam-va-toilet-fuwa3e-100ml-d45131", ["100ml"], "≈ 18.000đ / 100ml"],
  ["refill-nuoc-giat-bac-ha-fuwa3e-10l-a5ea8f", ["10000ml"], "≈ 9.900đ / 100ml"],
  ["nuoc-giat-huong-bac-ha-fuwa3e-3-5l-1aa0a7", ["3500ml"], "≈ 10.700đ / 100ml"],
  ["nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754", ["500ml"], "≈ 15.800đ / 100ml"],
  ["nuoc-giat-huong-bac-ha-fuwa3e-100ml-a53262", ["100ml"], "≈ 19.000đ / 100ml"],
  ["nuoc-giat-huong-cam-fuwa3e-500ml-2d5635", ["500ml"], "≈ 14.400đ / 100ml"],
  ["nuoc-giat-huong-cam-fuwa3e-100ml-c8b221", ["100ml"], "≈ 18.000đ / 100ml"],
  ["nuoc-rua-tay-dang-bot-fuwa3e-3-8l-948cc5", ["3800ml"], "≈ 15.400đ / 100ml"],
  ["nuoc-rua-tay-dang-bot-fuwa3e-300ml-fdf345", ["300ml"], "≈ 29.000đ / 100ml"],
  ["refill-nuoc-rua-tay-dang-gel-fuwa3e-10l-f3ac3e", ["10000ml"], "≈ 11.500đ / 100ml"],
  ["gel-rua-chen-cho-may-fuwa3e-500ml-f9915e", ["500ml"], "≈ 27.000đ / 100ml"],
  ["gel-rua-chen-cho-may-fuwa3e-100ml-e1aa04", ["100ml"], "≈ 30.000đ / 100ml"],
  ["nuoc-rua-chen-fuwa3e-100ml-c1337b", ["100ml"], "≈ 17.000đ / 100ml"],
  ["lau-da-nang-fuwa3e-2l-9aa0ed", ["2000ml"], "≈ 13.300đ / 100ml"],
  ["ve-sinh-nha-tam-va-toilet-fuwa3e-2l-4e8488", ["2000ml"], "≈ 11.300đ / 100ml"],
  ["nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0", ["300ml"], "≈ 25.000đ / 100ml"],
  ["nuoc-lau-ban-tho-fuwa3e-500ml-2a9b22", ["500ml"], "≈ 27.000đ / 100ml"],
  ["nuoc-giat-do-lot-fuwa3e-500ml-3e76e4", ["500ml"], "≈ 19.600đ / 100ml"],
  ["refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5", ["10000ml"], "≈ 5.900đ / 100ml"],
  ["refill-nuoc-lau-san-sa-chanh-fuwa3e-10l-b63811", ["10000ml"], "≈ 7.900đ / 100ml"],
  ["refill-nuoc-giat-cam-fuwa3e-10l-dc4433", ["10000ml"], "≈ 9.400đ / 100ml"],
  ["refill-nuoc-rua-chen-fuwa3e-10l-69f244", ["10000ml"], "≈ 8.900đ / 100ml"],
  ["nuoc-rua-chen-fuwa3e-500ml-185d77", ["500ml"], "≈ 13.600đ / 100ml"],
  ["nuoc-ngam-rua-thuc-pham-fuwa3e-1l-809601", ["1000ml"], "≈ 7.600đ / 100ml"],
  ["nuoc-lau-da-nang-fuwa3e-500ml-cbb309", ["500ml"], "≈ 19.000đ / 100ml"],
  ["nuoc-lau-san-sa-chanh-fuwa3e-1l-51b16f", ["1000ml"], "≈ 9.800đ / 100ml"],
  ["muoi-rua-chen-cho-may-fuwa3e-2kg-484ca1", ["2000g"], "≈ 7.300đ / 100g"],
  ["nuoc-rua-tay-dang-gel-fuwa3e-3-8l-74a392", ["3800ml"], "≈ 13.000đ / 100ml"],
  ["nuoc-ngam-rua-thuc-pham-fuwa3e-3-8l-7ececb", ["3800ml"], "≈ 6.400đ / 100ml"],
  ["nuoc-ho-tro-xa-lam-bong-fuwa3e-500ml-fb40eb", ["500ml"], "≈ 25.000đ / 100ml"],
  ["refill-ve-sinh-bon-cau-fuwa3e-10l-9a032c", ["10000ml"], "≈ 9.500đ / 100ml"],
  ["refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d", ["10000ml"], "≈ 17.500đ / 100ml"],
  ["refill-lau-da-nang-fuwa3e-10l-a08433", ["10000ml"], "≈ 11.500đ / 100ml"],
  ["ve-sinh-nha-tam-va-toilet-fuwa3e-500ml-b6da92", ["500ml"], "≈ 15.000đ / 100ml"],
  ["nuoc-giat-huong-cam-fuwa3e-3-5l-a0090c", ["3500ml"], "≈ 10.300đ / 100ml"],
  ["nuoc-rua-chen-fuwa3e-3-8l-ef3979", ["3800ml"], "≈ 10.100đ / 100ml"],
  ["dau-rua-mat-po-lang-100ml-55ml-8478ee", ["55ml","100ml"], "≈ 309.100đ / 100ml"],
  ["mat-na-bo-tuoi-po-lang-e3ccce", [null,null], null],
  ["nuoc-tuong-mat-hoa-dua-sokfarm-cham-034cc1", ["60ml","200ml","500ml","5000ml"], "≈ 50.000đ / 100ml"],
  ["mat-hoa-dua-co-dac-sokfarm-b0d1de", ["250g","685g","1400g","7000g"], "≈ 52.800đ / 100g"],
  ["duong-hoa-dua-sokfarm-d6c685", ["300g","1000g","5000g"], "≈ 41.700đ / 100g"],
  ["banh-mam-hat-yen-mach-bh-nong-ec5325", ["150g","210g","300g"], "≈ 60.000đ / 100g"],
  ["refill-nuoc-rua-tay-dang-bot-fuwa3e-10l-ab8688", ["10000ml"], "≈ 13.900đ / 100ml"],
  ["xit-khu-mui-o-to-fuwa3e-150ml-f33f4a", ["150ml"], "≈ 130.000đ / 100ml"],
  ["xit-thom-huong-xuan-fuwa3e-300ml-ff93d6", ["300ml"], "≈ 45.000đ / 100ml"],
  ["nuoc-mui-gia-po-lang-160ml-458227", [null,null], null],
  ["dau-goi-dau-xa-qua-bo-po-lang-300g-bef378", ["300g","300g",null], null],
  ["combo-son-duong-po-lang-1-thoi-co-mau-1-thoi-khong-mau-4de7da", [null], null],
  ["combo-sach-diu-nhe-po-lang-srm-tt-757657", [null], null],
  ["granola-mix-nuts-tui-tien-loi-bh-nong-3b8792", ["150g","300g"], "≈ 56.700đ / 100g"],
  ["bot-hat-cu-qua-bh-nong-lon-400g-9495bf", ["400g","400g"], null],
  ["banh-mam-hat-rong-bien-bh-nong-d93d32", ["210g","300g"], "≈ 71.400đ / 100g"],
  ["duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3", ["150g"], "≈ 73.300đ / 100g"],
  ["mat-co-dac-sokfarm-hop-12-goi-9139b9", ["12gói"], "≈ 11.300đ / gói"],
  ["sua-hat-gao-lut-nay-mam-bh-nong-lon-400g-e0cafb", ["400g"], "≈ 83.800đ / 100g"],
  ["xoai-say-deo-bh-nong-5f75de", ["100g","180g","280g"], "≈ 40.000đ / 100g"],
  ["thanh-gao-lut-cha-bong-bh-nong-240g-7eeee3", ["240g"], "≈ 54.200đ / 100g"],
  ["mixed-nuts-granola-tui-tien-loi-hat-dinh-duong-nuong-moc-ddfea1", ["150g","300g"], "≈ 56.700đ / 100g"],
  ["hop-thiec-banh-mam-hat-rong-bien-225g-ca06ae", ["225g"], "≈ 66.700đ / 100g"],
  ["hop-thiec-banh-mam-hat-yen-mach-225g-091083", ["225g"], "≈ 66.700đ / 100g"],
  ["ca-phe-sau-rieng-tui-20x20g-746f71", ["400g"], "≈ 27.500đ / 100g"],
  ["ca-phe-muoi-tui-50x16g-9fbabb", ["800g"], "≈ 36.300đ / 100g"],
  ["cho-be-duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-64ec0b", ["150g"], "≈ 73.300đ / 100g"],
  ["cho-be-nuoc-tuong-mat-hoa-dua-sokfarm-200ml-6b9b40", ["200ml"], "≈ 43.000đ / 100ml"],
  ["cho-be-mat-co-dac-sokfarm-250g-3c395c", ["250g"], "≈ 52.800đ / 100g"],
  ["nuoc-uong-mat-hoa-dua-tuoi-sokfarm-330ml-b68b8c", ["330ml","3960ml"], "≈ 12.100đ / 100ml"],
  ["gel-rua-chen-cho-may-fuwa3e-2000ml-ea1def", ["2000ml"], "≈ 19.300đ / 100ml"],
  ["dau-bo-tuoi-po-lang-30ml-10ml-40349e", ["10ml","30ml"], "≈ 1.200.000đ / 100ml"],
  ["nuoc-tay-trang-po-lang-300ml-97f185", ["300ml"], "≈ 65.000đ / 100ml"],
  ["dau-goi-thao-duoc-po-lang-300g-77bb42", ["300g","300g"], "≈ 60.000đ / 100g"],
  ["sua-rua-mat-tao-bot-po-lang-150ml-f15f0c", ["150ml"], "≈ 100.000đ / 100ml"],
  ["dau-u-toc-po-lang-50ml-867391", ["50ml"], "≈ 198.000đ / 100ml"],
  ["mat-na-ngu-po-lang-30g-7a51db", ["30g"], "≈ 783.300đ / 100g"],
  ["son-duong-co-mau-po-lang-a01-a03-a04-a05-ef066b", [null,null,null,null], null],
  ["son-duong-bo-tuoi-po-lang-a08-b6ae3f", [null], null],
  ["son-duong-gac-tuoi-a07-1c1b67", [null], null],
  ["dau-goi-thao-duoc-sam-visante-giam-gay-rung-500ml-cho-toc-yeu-gay-rung-chiet-xuat-sam-viet-nam-c21c23", ["100ml","250ml","500ml"], "≈ 88.000đ / 100ml"],
  ["dau-xa-thao-duoc-visante-chiet-xuat-sam-duong-toc-mem-muot-500ml-1314dc", ["100ml","100ml","500ml","500ml"], "≈ 68.000đ / 100ml"],
  ["xit-duong-toc-visante-thao-duoc-chiet-xuat-sam-ngan-rung-toc-100ml-010849", ["20ml","100ml"], "≈ 340.000đ / 100ml"],
  ["tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g-4500ef", ["25g","150g"], "≈ 220.000đ / 100g"],
  ["sua-rua-mat-tao-bot-visante-chiet-xuat-sam-lam-sach-diu-nhe-150ml-af8c13", ["30ml","30ml","150ml","150ml"], "≈ 160.000đ / 100ml"],
  ["nuoc-tay-trang-visante-chiet-xuat-sam-thien-nhien-diu-nhe-250ml-97377b", ["50ml","250ml"], "≈ 96.000đ / 100ml"],
  ["nuoc-tuong-mat-hoa-dua-sokfarm-nau-2dc907", ["500ml","1000ml","2000ml","5000ml"], "≈ 22.000đ / 100ml"],
  ["ca-phe-muoi-c-sea-dam-da-thom-beo-chuan-gu-hue-hop-16g-x-10-goi-a50737", ["160g"], "≈ 37.500đ / 100g"],
  ["ca-phe-sua-dua-hoa-tan-kafedua-le-plateau-thom-beo-16g-x-10-goi-7aecb7", ["160g"], "≈ 46.900đ / 100g"],
  ["ca-phe-trung-ahano-chuan-vi-ha-noi-thom-ngay-kho-cuong-4f0d97", [null], null],
  ["ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi-2c9db2", [null], null],
  ["nuoc-nam-dong-trung-ha-thao-hector-collagen-50ml-x-10-bo-sung-collagen-ho-tro-dep-da-93445f", ["500ml"], "≈ 122.000đ / 100ml"],
  ["nuoc-dong-trung-ha-thao-hector-collagen-plus-dep-da-chong-lao-hoa-70ml-x-10-chai-d0c0e1", ["700ml"], "≈ 101.400đ / 100ml"],
  ["nuoc-dong-trung-ha-thao-hector-sam-tang-cuong-suc-khoe-70ml-x-10-chai-192b87", ["700ml"], "≈ 70.000đ / 100ml"],
  ["nuoc-dong-trung-ha-thao-hector-lite-thanh-loc-co-the-70ml-x-10-chai-dieu-hoa-duong-huyet-db096e", ["700ml"], "≈ 70.000đ / 100ml"],
  ["nuoc-uong-sang-da-hector-white-collagen-dong-trung-ha-thao-50ml-x-10-lo-22ada5", ["500ml"], "≈ 120.000đ / 100ml"],
  ["nuoc-nam-dong-trung-ha-thao-hector-basic-dang-tui-25ml-x-10-goi-34b72c", ["250ml"], "≈ 108.000đ / 100ml"],
  ["socola-hoa-tan-uong-lien-choco-oke-4d912d", [null], null],
  ["tui-tim-granola-bh-nong-250g-2acd9e", ["250g"], "≈ 60.000đ / 100g"],
  ["granola-mix-trai-cay-say-bh-nong-lon-450g-1f07d6", ["450g"], "≈ 48.900đ / 100g"],
  ["sua-hat-gao-lut-nay-mam-bh-nong-khong-duong-400g-gom-18-loai-hat-thuan-chay-d149a9", ["400g"], "≈ 70.000đ / 100g"],
  ["tra-gao-lut-ray-dau-den-bh-nong-500g-0d8278", ["500g"], "≈ 30.000đ / 100g"],
  ["thanh-gao-lut-rong-bien-bh-nong-180g-da009b", ["180g"], "≈ 66.700đ / 100g"],
  ["dau-goi-thao-duoc-sam-visante-tri-gau-giam-bet-dau-500ml-cho-toc-gau-bet-dau-chiet-xuat-sam-29bafc", ["100ml","250ml","500ml"], "≈ 88.000đ / 100ml"],
  ["nuoc-uong-dong-trung-ha-thao-hector-thao-moc-25ml-x-10-goi-boi-bo-co-the-tang-suc-de-khang-ea3d0e", ["250ml"], "≈ 88.000đ / 100ml"],
];

describe('parseNetAmount trên ảnh chụp PROD 18/11/2026', () => {
  it('bảng soát tay phủ đủ 111 sản phẩm, đúng thứ tự fixture', () => {
    expect(REVIEWED.map((r) => r[0])).toEqual(PROD_VARIATIONS_2026_11_18.map((p) => p.slug));
  });

  it.each(PROD_VARIATIONS_2026_11_18.map((p, i) => [p.slug, p, REVIEWED[i]!] as const))('%s', (_slug, p, [, amounts, line]) => {
    expect(p.variations.map((v) => amount(v.name, p.name))).toEqual(amounts);
    const vars = p.variations.map((v, i) => ({ id: String(i), name: v.name, stock: v.inStock ? 1 : 0, price: v.salePrice ?? v.retailPrice }));
    expect(unitPriceView(vars, p.name, '0')?.line ?? null).toBe(line);
  });

  it('độ phủ: 99/111 sản phẩm hiện được, 12 không hiện (không đoán)', () => {
    const shown = REVIEWED.filter((r) => r[2] !== null).length;
    expect(shown).toBe(99);
    expect(REVIEWED.length - shown).toBe(12);
  });
});

describe('parseNetAmount: cách ghi và ca bẫy', () => {
  it.each([
    ['500ml', '500ml'],
    ['500 ml', '500ml'],
    ['500ML', '500ml'],
    ['1L', '1000ml'],
    ['1 lít', '1000ml'],
    ['1,5L', '1500ml'],
    ['1.5L', '1500ml'],
    ['2,1L', '2100ml'],
    ['1.000ml', '1000ml'],
    ['2000ml', '2000ml'],
    ['Refill 10L', '10000ml'],
    ['250G', '250g'],
    ['500gr', '500g'],
    ['25gr', '25g'],
    ['1,4KG', '1400g'],
    ['2kg', '2000g'],
    ['Hộp thiếc 210g', '210g'],
    ['3 x 500ml', '1500ml'],
    ['3x500ml', '1500ml'],
    ['500ml x 3', '1500ml'],
    ['20x20g', '400g'],
    ['Hộp 16g x 10 gói', '160g'],
    ['Combo 2 chai 1L', '2000ml'],
    ['combo 2 chai 1L', '2000ml'],
    ['Thùng 12 hộp 330ml', '3960ml'],
    ['2 túi 500g', '1000g'],
    ['Hộp 330ml', '330ml'],
    ['Hộp 30 viên', '30viên'],
    ['Gói 10 miếng', '10miếng'],
    ['Túi 3 cuộn', '3cuộn'],
    ['Hộp 12 gói', '12gói'],
    ['100 tờ', '100tờ'],
    ['3in1 500ml', '500ml'],
    ['SPF50 50ml', '50ml'],
    ['pH 5.5 500ml', '500ml'],
    ['Nước giặt Fuwa3e 500ml', '500ml'],
    ['3.8L (3800ml)', '3800ml'],
  ])('%s → %s', (name, want) => {
    expect(amount(name)).toBe(want);
  });

  it.each([
    ['Combo 2'],
    ['Combo gội xả'],
    ['Size L'],
    ['3in1'],
    ['SPF50'],
    ['pH 5.5'],
    ['Fuwa3e'],
    ['A05'],
    ['1 set'],
    ['Combo 10 set'],
    ['1 chai'],
    ['Combo 2 chai'],
    ['2 lớp'],
    ['100ml/55ml'],
    ['Gel 2L 500ml'],
    ['2 chai, mỗi chai 500ml'],
    ['3 x 500ml x 2'],
    ['Gói 10 miếng 500g'],
    ['Hộp g x 10 Gói'],
    ['Bộ 500ml'],
    ['Combo 500ml'],
    ['Sữa hạt 180ml x 4 hộp x 12 lốc'],
    ['Dầu gội 500ml + Dầu xả 500ml'],
    ['Nước rửa tay 1/2 L'],
    ['Nước ×2 1L'],
  ])('%s → không đọc', (name) => {
    expect(amount(name)).toBeNull();
  });

  it('tên phân loại không có chữ số thì đọc tên sản phẩm; có số mà không đọc chắc thì dừng, không lùi về tên sản phẩm', () => {
    expect(amount('Mùi sả', 'Nước lau sàn Fuwa3e 1L')).toBe('1000ml');
    expect(amount('', 'Nước giặt cho bé Pineboo 2,1L')).toBe('2100ml');
    expect(amount('Combo 2', 'Nước mùi già PƠ LANG 160ml')).toBeNull();
    expect(amount('Combo gội xả', 'Dầu gội - Dầu xả quả bơ PƠ LANG 300g')).toBeNull();
    expect(amount('Size L', 'Áo thun')).toBeNull();
  });
});

const v = (id: string, name: string, price: number, stock = 5): UnitPriceVariation => ({ id, name, price, stock });

describe('unitPriceView', () => {
  const sizes = [v('a', '500ml', 79_000), v('b', '3,5L', 375_000), v('c', 'Refill 10L', 990_000)];

  it('dòng dưới giá theo phân loại đang chọn, chip có giá theo đơn vị của từng cỡ, nhãn ở cỡ rẻ nhất mỗi 100ml', () => {
    const view = unitPriceView(sizes, 'Nước giặt hương Bạc hà Fuwa3e', 'a')!;
    expect(view.line).toBe('≈ 15.800đ / 100ml');
    expect(view.chips).toEqual({ a: '≈ 15.800đ / 100ml', b: '≈ 10.700đ / 100ml', c: '≈ 9.900đ / 100ml' });
    // 9.900 so với 15.800: rẻ hơn 37,3%, làm tròn xuống.
    expect(view.better).toEqual({ id: 'c', text: 'Lợi hơn 37% mỗi 100ml' });
  });

  it('đang chọn đúng cỡ rẻ nhất thì không có nhãn', () => {
    expect(unitPriceView(sizes, 'x', 'c')!.better).toBeNull();
  });

  it('cỡ rẻ nhất đang hết hàng thì nhãn sang cỡ còn hàng rẻ nhất; hết hàng không bao giờ có nhãn', () => {
    const view = unitPriceView([sizes[0]!, sizes[1]!, { ...sizes[2]!, stock: 0 }], 'x', 'a')!;
    expect(view.better).toEqual({ id: 'b', text: 'Lợi hơn 32% mỗi 100ml' });
    expect(unitPriceView([sizes[0]!, { ...sizes[1]!, stock: 0 }, { ...sizes[2]!, stock: 0 }], 'x', 'a')!.better).toBeNull();
  });

  it('chênh dưới 5% thì không có nhãn; đúng 5% thì có', () => {
    expect(unitPriceView([v('a', '100ml', 20_000), v('b', '200ml', 38_100)], 'x', 'a')!.better).toBeNull();
    expect(unitPriceView([v('a', '100ml', 20_000), v('b', '200ml', 38_000)], 'x', 'a')!.better).toEqual({ id: 'b', text: 'Lợi hơn 5% mỗi 100ml' });
  });

  it('tối đa một nhãn', () => {
    const view = unitPriceView([v('a', '100ml', 20_000), v('b', '1L', 100_000), v('c', '2L', 150_000)], 'x', 'a')!;
    expect(view.better).toEqual({ id: 'c', text: 'Lợi hơn 62% mỗi 100ml' });
  });

  it('một phân loại: có dòng dưới giá, không chip, không nhãn', () => {
    expect(unitPriceView([v('a', '', 285_000)], 'Nước giặt cho bé Pineboo 2,1L', 'a')).toEqual({ line: '≈ 13.600đ / 100ml', chips: null, better: null });
  });

  it('cùng một lượng ghi trong tên phân loại (khác mùi): không chip, không nhãn dù giá khác', () => {
    const view = unitPriceView([v('a', 'Không đường 400g', 250_000), v('b', 'Vị đường hoa dừa 400g', 280_000)], 'Bột hạt củ quả', 'b')!;
    expect(view).toEqual({ line: '≈ 70.000đ / 100g', chips: null, better: null });
  });

  it('phân loại không ghi lượng mượn lượng ở tên sản phẩm: cùng giá thì tin (khác mùi), khác giá thì không hiện (có thể là khác cỡ)', () => {
    expect(unitPriceView([v('a', 'Mùi sả', 79_000), v('b', 'Mùi quế', 79_000)], 'Nước lau sàn 1L', 'a')?.line).toBe('≈ 7.900đ / 100ml');
    expect(unitPriceView([v('a', 'Chai nhỏ', 100_000), v('b', 'Chai lớn', 180_000)], 'Nước giặt 500ml', 'b')).toBeNull();
    expect(unitPriceView([v('a', 'Không đường', 250_000), v('b', 'Vị đường hoa dừa', 280_000)], 'Bột hạt củ quả BH.NONG - Lon 400g', 'b')).toBeNull();
  });

  it('nhãn "Lợi hơn": bằng giá theo đơn vị thì chọn phân loại cùng loại với cái đang chọn', () => {
    const skin = [v('a', 'DA KHÔ – 30ml', 60_000), v('b', 'DA DẦU – 150ml', 240_000), v('c', 'DA KHÔ – 150ml', 240_000)];
    expect(unitPriceView(skin, 'Sữa rửa mặt', 'a')?.better?.id).toBe('c');
  });

  it('không đoán: một phân loại không đọc được, hay khác chiều (ml với g), thì cả sản phẩm không có gì', () => {
    expect(unitPriceView([v('a', '500ml', 79_000), v('b', 'Combo 2', 150_000)], 'x', 'a')).toBeNull();
    expect(unitPriceView([v('a', '500ml', 79_000), v('b', '500g', 79_000)], 'x', 'a')).toBeNull();
    expect(unitPriceView([v('a', 'Hộp 10 viên', 50_000), v('b', 'Hộp 10 gói', 50_000)], 'x', 'a')).toBeNull();
    expect(unitPriceView([], 'x', null)).toBeNull();
    expect(unitPriceView([v('a', '500ml', 0)], 'x', 'a')).toBeNull();
  });

  it('đếm món: giá mỗi món, nhãn "mỗi gói"', () => {
    const view = unitPriceView([v('a', 'Hộp 12 gói', 135_000), v('b', 'Hộp 30 gói', 300_000)], 'x', 'a')!;
    expect(view.line).toBe('≈ 11.300đ / gói');
    expect(view.better).toEqual({ id: 'b', text: 'Lợi hơn 11% mỗi gói' });
  });

  it('giá dùng để chia là giá truyền vào (giá Giờ vàng khi đang chạy), không tự tính lại', () => {
    expect(unitPriceView([v('a', '500ml', 50_000)], 'x', 'a')!.line).toBe('≈ 10.000đ / 100ml');
  });

  it('phần trăm tròn trong toán không bị số thực kéo xuống một bậc', () => {
    expect(unitPriceView([v('a', 'Gói 40 tờ', 14_000), v('b', 'Gói 80 tờ', 35_000)], 'x', 'b')!.better).toEqual({ id: 'a', text: 'Lợi hơn 20% mỗi tờ' });
  });

  it('chưa chọn hay chọn id lạ thì lấy phân loại đầu', () => {
    expect(unitPriceView(sizes, 'x', undefined)!.line).toBe('≈ 15.800đ / 100ml');
    expect(unitPriceView(sizes, 'x', 'zz')!.line).toBe('≈ 15.800đ / 100ml');
  });
});

describe('variationUnitPrices: giá chia theo đúng luật Giờ vàng của chip', () => {
  const raw = [
    { id: 'a', name: '500ml', stock: 5, retailPrice: 90_000, salePrice: 79_000 },
    { id: 'b', name: '1L', stock: 5, retailPrice: 150_000, salePrice: null },
  ];

  it('không Giờ vàng: chia giá đang bán (salePrice ?? giá gốc)', () => {
    expect(variationUnitPrices(raw, [], 'x', 'a')).toEqual(unitPriceView([{ id: 'a', name: '500ml', stock: 5, price: 79_000 }, { id: 'b', name: '1L', stock: 5, price: 150_000 }], 'x', 'a'));
  });

  it('Giờ vàng rẻ hơn thì chia giá Giờ vàng; đắt hơn giá đang bán thì bỏ qua', () => {
    const flash = [{ productSlug: 's', variationId: 'b', flashPrice: 120_000 }];
    expect(variationUnitPrices(raw, flash, 'x', 'b')!.line).toBe('≈ 12.000đ / 100ml');
    expect(variationUnitPrices(raw, [{ productSlug: 's', variationId: 'a', flashPrice: 85_000 }], 'x', 'a')!.line).toBe('≈ 15.800đ / 100ml');
  });
});
