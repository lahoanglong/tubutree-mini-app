import type { Prisma } from '@prisma/client';

/**
 * Dữ liệu demo mà migration `20260616000000_demo_catalog_multibrand` nạp vào MỌI DB mới, kể cả PROD ở lần
 * `prisma migrate deploy` đầu tiên: 44 sản phẩm, 48 biến thể (ảnh picsum, sau bị migration 20260703010000 xoá ảnh),
 * 7 danh mục và 3 mã công khai còn hạn. Migration đã chạy ở nhiều môi trường nên không sửa được (lệch checksum);
 * thay vào đó `prisma/cleanup-demo-data.ts` tắt chúng và go-live check báo đỏ khi còn.
 *
 * Chép nguyên văn từ file migration, không suy theo mẫu tên; `demo-catalog.spec.ts` đối chiếu lại với file.
 * `prisma/seed.ts` sinh cùng pancakeId (`seed-<id SP>`, `seed-<sku>`), id SP và mã, nhưng id biến thể và id mã là cuid
 * khác ở mỗi lần seed: nhận diện sản phẩm/biến thể theo pancakeId (unique, không bao giờ là mã Pancake thật).
 */
export const DEMO_MIGRATION = '20260616000000_demo_catalog_multibrand';

export interface DemoProduct {
  id: string;
  pancakeId: string;
  slug: string;
}

export interface DemoVariation {
  id: string;
  pancakeId: string;
  productId: string;
  sku: string;
}

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  { id: 'p-bhnong-cagaileo', pancakeId: 'seed-p-bhnong-cagaileo', slug: 'cao-ca-gai-leo-bhnong' },
  { id: 'p-bhnong-cashew', pancakeId: 'seed-p-bhnong-cashew', slug: 'hat-dieu-rang-moc-bhnong' },
  { id: 'p-bhnong-honey', pancakeId: 'seed-p-bhnong-honey', slug: 'mat-ong-rung-bhnong' },
  { id: 'p-bhnong-pepper', pancakeId: 'seed-p-bhnong-pepper', slug: 'tieu-den-bhnong' },
  { id: 'p-bhnong-tea', pancakeId: 'seed-p-bhnong-tea', slug: 'tra-thao-moc-bhnong' },
  { id: 'p-cobote-diapercream', pancakeId: 'seed-p-cobote-diapercream', slug: 'kem-chong-ham-cobote' },
  { id: 'p-cobote-massage', pancakeId: 'seed-p-cobote-massage', slug: 'dau-massage-be-cobote' },
  { id: 'p-cobote-powder', pancakeId: 'seed-p-cobote-powder', slug: 'phan-rom-thao-duoc-cobote' },
  { id: 'p-cobote-tram', pancakeId: 'seed-p-cobote-tram', slug: 'dau-tram-be-cobote' },
  { id: 'p-cobote-wash', pancakeId: 'seed-p-cobote-wash', slug: 'nuoc-tam-goi-be-cobote' },
  { id: 'p-fuwa-bottle', pancakeId: 'seed-p-fuwa-bottle', slug: 'nuoc-rua-binh-sua-fuwa3e' },
  { id: 'p-fuwa-dishwash', pancakeId: 'seed-p-fuwa-dishwash', slug: 'nuoc-rua-chen-fuwa3e' },
  { id: 'p-fuwa-floor', pancakeId: 'seed-p-fuwa-floor', slug: 'nuoc-lau-san-fuwa3e' },
  { id: 'p-fuwa-glass', pancakeId: 'seed-p-fuwa-glass', slug: 'nuoc-lau-kinh-fuwa3e' },
  { id: 'p-fuwa-handwash', pancakeId: 'seed-p-fuwa-handwash', slug: 'nuoc-rua-tay-fuwa3e' },
  { id: 'p-fuwa-laundry', pancakeId: 'seed-p-fuwa-laundry', slug: 'nuoc-giat-fuwa3e' },
  { id: 'p-hector-clay', pancakeId: 'seed-p-hector-clay', slug: 'sap-vuot-toc-hector' },
  { id: 'p-hector-deo', pancakeId: 'seed-p-hector-deo', slug: 'lan-khu-mui-hector' },
  { id: 'p-hector-facewash', pancakeId: 'seed-p-hector-facewash', slug: 'sua-rua-mat-than-tre-hector' },
  { id: 'p-hector-shampoo', pancakeId: 'seed-p-hector-shampoo', slug: 'dau-goi-bac-ha-hector' },
  { id: 'p-leplateau-arabica', pancakeId: 'seed-p-leplateau-arabica', slug: 'arabica-cau-dat-le-plateau' },
  { id: 'p-leplateau-coldbrew', pancakeId: 'seed-p-leplateau-coldbrew', slug: 'cold-brew-tui-loc-le-plateau' },
  { id: 'p-leplateau-drip', pancakeId: 'seed-p-leplateau-drip', slug: 'ca-phe-phin-giay-le-plateau' },
  { id: 'p-leplateau-instant', pancakeId: 'seed-p-leplateau-instant', slug: 'ca-phe-sua-hoa-tan-le-plateau' },
  { id: 'p-leplateau-robusta', pancakeId: 'seed-p-leplateau-robusta', slug: 'robusta-honey-le-plateau' },
  { id: 'p-polang-bodywash', pancakeId: 'seed-p-polang-bodywash', slug: 'sua-tam-sa-po-lang' },
  { id: 'p-polang-facemist', pancakeId: 'seed-p-polang-facemist', slug: 'xit-khoang-hoa-hong-po-lang' },
  { id: 'p-polang-ginger', pancakeId: 'seed-p-polang-ginger', slug: 'dau-gung-po-lang' },
  { id: 'p-polang-hairoil', pancakeId: 'seed-p-polang-hairoil', slug: 'dau-duong-toc-bo-ket-po-lang' },
  { id: 'p-polang-lemongrass', pancakeId: 'seed-p-polang-lemongrass', slug: 'tinh-dau-sa-chanh-po-lang' },
  { id: 'p-polang-shampoo', pancakeId: 'seed-p-polang-shampoo', slug: 'dau-goi-buoi-po-lang' },
  { id: 'p-sokfram-centella', pancakeId: 'seed-p-sokfram-centella', slug: 'bot-rau-ma-sokfram' },
  { id: 'p-sokfram-chia', pancakeId: 'seed-p-sokfram-chia', slug: 'hat-chia-uc-sokfram' },
  { id: 'p-sokfram-coconut', pancakeId: 'seed-p-sokfram-coconut', slug: 'dau-dua-ep-lanh-sokfram' },
  { id: 'p-sokfram-granola', pancakeId: 'seed-p-sokfram-granola', slug: 'granola-hat-sokfram' },
  { id: 'p-sokfram-rice', pancakeId: 'seed-p-sokfram-rice', slug: 'gao-lut-huyet-rong-sokfram' },
  { id: 'p-visante-cleanser', pancakeId: 'seed-p-visante-cleanser', slug: 'nuoc-tay-trang-rau-ma-visante' },
  { id: 'p-visante-cream', pancakeId: 'seed-p-visante-cream', slug: 'kem-duong-ba-bau-visante' },
  { id: 'p-visante-eye', pancakeId: 'seed-p-visante-eye', slug: 'kem-mat-rau-ma-visante' },
  { id: 'p-visante-lipbalm', pancakeId: 'seed-p-visante-lipbalm', slug: 'son-duong-gac-visante' },
  { id: 'p-visante-mask', pancakeId: 'seed-p-visante-mask', slug: 'mat-na-rau-ma-visante' },
  { id: 'p-visante-serum', pancakeId: 'seed-p-visante-serum', slug: 'serum-duong-am-visante' },
  { id: 'p-visante-sunscreen', pancakeId: 'seed-p-visante-sunscreen', slug: 'kem-chong-nang-khoang-visante' },
  { id: 'p-visante-vitc', pancakeId: 'seed-p-visante-vitc', slug: 'tinh-chat-vitamin-c-visante' },
];

export const DEMO_VARIATIONS: readonly DemoVariation[] = [
  { id: 'cmqfuw9jj0001w1vfrccaij5o', pancakeId: 'seed-POLANG-SP-300', productId: 'p-polang-shampoo', sku: 'POLANG-SP-300' },
  { id: 'cmqfuw9jo0003w1vfvkx2j48l', pancakeId: 'seed-POLANG-SP-500', productId: 'p-polang-shampoo', sku: 'POLANG-SP-500' },
  { id: 'cmqfuw9jt0005w1vfkndxukxy', pancakeId: 'seed-FUWA-DW-1L', productId: 'p-fuwa-dishwash', sku: 'FUWA-DW-1L' },
  { id: 'cmqfuw9jv0007w1vfb1njbw7k', pancakeId: 'seed-FUWA-DW-5L', productId: 'p-fuwa-dishwash', sku: 'FUWA-DW-5L' },
  { id: 'cmqfuw9jy0009w1vfn8il35y6', pancakeId: 'seed-VIS-SR-30', productId: 'p-visante-serum', sku: 'VIS-SR-30' },
  { id: 'cmqfuw9k2000bw1vfnqnknvfc', pancakeId: 'seed-FUWA-LD-2L', productId: 'p-fuwa-laundry', sku: 'FUWA-LD-2L' },
  { id: 'cmqfuw9k5000dw1vf2tdedsu4', pancakeId: 'seed-POLANG-BW-500', productId: 'p-polang-bodywash', sku: 'POLANG-BW-500' },
  { id: 'cmqfuw9ka000fw1vfu3yl2jph', pancakeId: 'seed-VIS-CR-100', productId: 'p-visante-cream', sku: 'VIS-CR-100' },
  { id: 'cmqfv2cky0003zxpl45lh4ggm', pancakeId: 'seed-VIS-SR-50', productId: 'p-visante-serum', sku: 'VIS-SR-50' },
  { id: 'cmqfv2cl90007zxpllq9mw8h1', pancakeId: 'seed-VIS-CL-300', productId: 'p-visante-cleanser', sku: 'VIS-CL-300' },
  { id: 'cmqfv2cle0009zxpljhaxy9ny', pancakeId: 'seed-VIS-SUN-50', productId: 'p-visante-sunscreen', sku: 'VIS-SUN-50' },
  { id: 'cmqfv2clh000bzxpl4iysg6k0', pancakeId: 'seed-VIS-MASK-1', productId: 'p-visante-mask', sku: 'VIS-MASK-1' },
  { id: 'cmqfv2clk000dzxpl77y1nlvo', pancakeId: 'seed-VIS-LIP-4', productId: 'p-visante-lipbalm', sku: 'VIS-LIP-4' },
  { id: 'cmqfv2cly000lzxplzmfsw4ze', pancakeId: 'seed-POLANG-GG-100', productId: 'p-polang-ginger', sku: 'POLANG-GG-100' },
  { id: 'cmqfv2cm2000nzxplhcpee2k8', pancakeId: 'seed-POLANG-LG-10', productId: 'p-polang-lemongrass', sku: 'POLANG-LG-10' },
  { id: 'cmqfv2cm6000pzxplj5ipj3dz', pancakeId: 'seed-POLANG-FM-150', productId: 'p-polang-facemist', sku: 'POLANG-FM-150' },
  { id: 'cmqfv2cmj000xzxplrbaoikwf', pancakeId: 'seed-FUWA-FL-2L', productId: 'p-fuwa-floor', sku: 'FUWA-FL-2L' },
  { id: 'cmqfv2cmm000zzxplbqlf8d47', pancakeId: 'seed-FUWA-HW-500', productId: 'p-fuwa-handwash', sku: 'FUWA-HW-500' },
  { id: 'cmqfv2cmq0011zxpl67fkxph0', pancakeId: 'seed-FUWA-BT-500', productId: 'p-fuwa-bottle', sku: 'FUWA-BT-500' },
  { id: 'cmqfv2cmu0013zxpltkclxi2l', pancakeId: 'seed-COBOTE-TR-50', productId: 'p-cobote-tram', sku: 'COBOTE-TR-50' },
  { id: 'cmqfv2cmx0015zxpliyqff23n', pancakeId: 'seed-COBOTE-WS-250', productId: 'p-cobote-wash', sku: 'COBOTE-WS-250' },
  { id: 'cmqfv2cn10017zxpl3ga9aqov', pancakeId: 'seed-COBOTE-PW-100', productId: 'p-cobote-powder', sku: 'COBOTE-PW-100' },
  { id: 'cmqfv2cn40019zxpl2qpbbuz9', pancakeId: 'seed-COBOTE-DC-50', productId: 'p-cobote-diapercream', sku: 'COBOTE-DC-50' },
  { id: 'cmqfv2cn8001bzxplgwqxryd7', pancakeId: 'seed-LP-ARA-250', productId: 'p-leplateau-arabica', sku: 'LP-ARA-250' },
  { id: 'cmqfv2cna001dzxplgpkfevuc', pancakeId: 'seed-LP-ARA-250-F', productId: 'p-leplateau-arabica', sku: 'LP-ARA-250-F' },
  { id: 'cmqfv2cne001fzxplyiuh0ubv', pancakeId: 'seed-LP-ROB-250', productId: 'p-leplateau-robusta', sku: 'LP-ROB-250' },
  { id: 'cmqfv2cnh001hzxplrhjcbe6i', pancakeId: 'seed-LP-DRIP-10', productId: 'p-leplateau-drip', sku: 'LP-DRIP-10' },
  { id: 'cmqfv2cnk001jzxpl47uenljj', pancakeId: 'seed-LP-CB-5', productId: 'p-leplateau-coldbrew', sku: 'LP-CB-5' },
  { id: 'cmqfv2cnp001lzxpldj0hlwq2', pancakeId: 'seed-BHN-HN-500', productId: 'p-bhnong-honey', sku: 'BHN-HN-500' },
  { id: 'cmqfv2cns001nzxplvuhm8hyq', pancakeId: 'seed-BHN-CW-500', productId: 'p-bhnong-cashew', sku: 'BHN-CW-500' },
  { id: 'cmqfv2cnv001pzxpljb96x5t3', pancakeId: 'seed-BHN-PP-200', productId: 'p-bhnong-pepper', sku: 'BHN-PP-200' },
  { id: 'cmqfv2cny001rzxplrwccxk9l', pancakeId: 'seed-BHN-TEA-20', productId: 'p-bhnong-tea', sku: 'BHN-TEA-20' },
  { id: 'cmqfv2co1001tzxplz8u0kdgs', pancakeId: 'seed-SOK-RC-1KG', productId: 'p-sokfram-rice', sku: 'SOK-RC-1KG' },
  { id: 'cmqfv2co7001vzxplf8ka2cqo', pancakeId: 'seed-SOK-CO-500', productId: 'p-sokfram-coconut', sku: 'SOK-CO-500' },
  { id: 'cmqfv2coa001xzxpltjepz3ee', pancakeId: 'seed-SOK-CT-150', productId: 'p-sokfram-centella', sku: 'SOK-CT-150' },
  { id: 'cmqfv2cod001zzxpl11l7qcbj', pancakeId: 'seed-SOK-GR-400', productId: 'p-sokfram-granola', sku: 'SOK-GR-400' },
  { id: 'cmqfv2cog0021zxpl1nny40zl', pancakeId: 'seed-HEC-CL-80', productId: 'p-hector-clay', sku: 'HEC-CL-80' },
  { id: 'cmqfv2cok0023zxpldwfrc7q2', pancakeId: 'seed-HEC-FW-120', productId: 'p-hector-facewash', sku: 'HEC-FW-120' },
  { id: 'cmqfv2coo0025zxplxiucn77n', pancakeId: 'seed-HEC-SH-300', productId: 'p-hector-shampoo', sku: 'HEC-SH-300' },
  { id: 'cmqfv2cor0027zxplzj1loywb', pancakeId: 'seed-HEC-DEO-50', productId: 'p-hector-deo', sku: 'HEC-DEO-50' },
  { id: 'cmqfv3q5t0029cgcob3flmcuv', pancakeId: 'seed-VIS-VITC-20', productId: 'p-visante-vitc', sku: 'VIS-VITC-20' },
  { id: 'cmqfv3q5z002bcgcok2ziwtlw', pancakeId: 'seed-VIS-EYE-15', productId: 'p-visante-eye', sku: 'VIS-EYE-15' },
  { id: 'cmqfv3q63002dcgcojpljp11u', pancakeId: 'seed-POLANG-HO-50', productId: 'p-polang-hairoil', sku: 'POLANG-HO-50' },
  { id: 'cmqfv3q67002fcgcoxpqsxpb4', pancakeId: 'seed-FUWA-GL-500', productId: 'p-fuwa-glass', sku: 'FUWA-GL-500' },
  { id: 'cmqfv3q6a002hcgco5nxp0lzl', pancakeId: 'seed-COBOTE-MS-100', productId: 'p-cobote-massage', sku: 'COBOTE-MS-100' },
  { id: 'cmqfv3q6e002jcgcojneu7uab', pancakeId: 'seed-LP-INS-12', productId: 'p-leplateau-instant', sku: 'LP-INS-12' },
  { id: 'cmqfv3q6h002lcgcou94v9rfl', pancakeId: 'seed-BHN-CGL-100', productId: 'p-bhnong-cagaileo', sku: 'BHN-CGL-100' },
  { id: 'cmqfv3q6m002ncgco4pgk0rh7', pancakeId: 'seed-SOK-CH-500', productId: 'p-sokfram-chia', sku: 'SOK-CH-500' },
];

/**
 * Migration ghi createdAt = updatedAt cho 44 sản phẩm, trễ nhất 2026-06-15T16:46:25.484Z (làm tròn lên giây). Không migration
 * nào sau đó đổi updatedAt của chúng, nên sản phẩm demo có updatedAt muộn hơn là đã có người sửa qua ứng dụng.
 */
export const DEMO_PRODUCTS_LOADED_AT = new Date('2026-06-15T16:46:26.000Z');

/** Giữ nguyên khi dọn (chỉ báo danh mục nào sẽ trống): đồng bộ Pancake không ghi categoryIds, danh mục do admin quyết. */
export const DEMO_CATEGORIES: ReadonlyArray<{ id: string; slug: string }> = [
  { id: 'cat-baby', slug: 'cho-be' },
  { id: 'cat-cleaning', slug: 'tay-rua-sinh-hoc' },
  { id: 'cat-coffee', slug: 'ca-phe-do-uong' },
  { id: 'cat-food', slug: 'nong-san-thuc-pham' },
  { id: 'cat-mom', slug: 'cho-me-bau' },
  { id: 'cat-personal', slug: 'cham-soc-ca-nhan' },
  { id: 'cat-skincare', slug: 'my-pham-thien-nhien' },
];

/** Điều kiện mã demo, giống hệt giữa migration và `prisma/seed.ts` (chỉ khác id, startAt, endAt). */
export interface DemoCouponTerms {
  type: 'AMOUNT' | 'FREESHIP' | 'PERCENT';
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  perUserLimit: number;
  scope: 'PUBLIC';
}

/**
 * Ba mã PUBLIC chủ dự án chưa duyệt: WELCOME30 (30.000đ, đơn từ 199.000đ, không trần tổng lượt, 1 lượt/người), FREESHIP
 * (đơn từ 99.000đ, 3 lượt/người), XANH10 (10%, tối đa 50.000đ, đơn từ 250.000đ, 2 lượt/người). Migration tạo với id dưới
 * đây, hạn tới 2026-12-31, và bỏ qua khi mã đã có. `prisma db seed` upsert cùng mã, cùng điều kiện, id cuid mới, hạn tới
 * 2027-01-01. Xem `classifyDemoCoupon`.
 */
export const DEMO_COUPONS: ReadonlyArray<{ id: string; code: string; terms: DemoCouponTerms }> = [
  {
    id: 'cmqfuw9l0000gw1vf8f2wozy0',
    code: 'WELCOME30',
    terms: { type: 'AMOUNT', value: 30000, minOrder: 199000, maxDiscount: null, perUserLimit: 1, scope: 'PUBLIC' },
  },
  {
    id: 'cmqfv2cpl0029zxplw4kcnaji',
    code: 'FREESHIP',
    terms: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, perUserLimit: 3, scope: 'PUBLIC' },
  },
  {
    id: 'cmqfv2cpn002azxplta2xvgp8',
    code: 'XANH10',
    terms: { type: 'PERCENT', value: 10, minOrder: 250000, maxDiscount: 50000, perUserLimit: 2, scope: 'PUBLIC' },
  },
];

/**
 * - `migration`: đúng dòng migration tạo (id khớp), dù sau đó có ai sửa điều kiện.
 * - `seed`: id khác nhưng mã và điều kiện khớp bản demo, tức dòng `prisma db seed` tạo trên DB từng chạy seed.
 * - `name-only`: chỉ trùng mã, điều kiện khác: coi là mã thật chủ shop tạo hoặc đã sửa, dọn không đụng.
 * Hai loại đầu là mã demo: `--coupons=expire` tắt, go-live sau deploy FAIL.
 */
export type DemoCouponKind = 'migration' | 'seed' | 'name-only';

export const DEMO_COUPON_SELECT = {
  id: true,
  code: true,
  type: true,
  value: true,
  minOrder: true,
  maxDiscount: true,
  perUserLimit: true,
  scope: true,
} satisfies Prisma.CouponSelect;

type CouponTermsRow = Prisma.CouponGetPayload<{ select: typeof DEMO_COUPON_SELECT }>;

/** null khi mã không phải mã demo. */
export function classifyDemoCoupon(row: CouponTermsRow): DemoCouponKind | null {
  const demo = DEMO_COUPONS.find((c) => c.code === row.code);
  if (!demo) return null;
  if (demo.id === row.id) return 'migration';
  const t = demo.terms;
  const same =
    row.type === t.type &&
    row.value === t.value &&
    row.minOrder === t.minOrder &&
    row.maxDiscount === t.maxDiscount &&
    row.perUserLimit === t.perUserLimit &&
    row.scope === t.scope;
  return same ? 'seed' : 'name-only';
}

export const isDemoCouponKind = (k: DemoCouponKind | null): k is 'migration' | 'seed' => k === 'migration' || k === 'seed';

/**
 * Nhãn mà migration `20260626020000_brand_backfill` tạo từ tên nhãn của sản phẩm demo (id = md5(tên), isPublished=false).
 * Có thể là nhãn thật Tubu Tree phân phối (sản phẩm Pancake cùng tên nhãn sẽ gắn vào), nên dọn KHÔNG đụng, chỉ báo.
 */
export const DEMO_BRANDS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '820b8d831eb57ea2f9adaac2be6b65b7', name: 'BH.Nong' },
  { id: '465f2461460249939490207ce8f9bd5b', name: 'Cobote' },
  { id: '75ae0443eea88aa90f3c2bec9bc3ece1', name: 'Fuwa3e' },
  { id: 'f7cb72400bd7fb19294e1f9692c48cd9', name: 'Hector' },
  { id: 'c17179a6db7a834fb350fde178147af1', name: 'Le Plateau Coffee' },
  { id: 'a5aceb2cb9837795f0dccfec2013385f', name: 'Pơ Lang' },
  { id: '01218481b64ed06ed245140fb478932e', name: 'Sokfram' },
  { id: 'ca4b707a9ac34c7eb74d5af3a45a8a43', name: 'Visante' },
];

export const DEMO_PRODUCT_PANCAKE_IDS: readonly string[] = DEMO_PRODUCTS.map((p) => p.pancakeId);
export const DEMO_VARIATION_PANCAKE_IDS: readonly string[] = DEMO_VARIATIONS.map((v) => v.pancakeId);

export const DEMO_PRODUCT_WHERE = { pancakeId: { in: [...DEMO_PRODUCT_PANCAKE_IDS] } } satisfies Prisma.ProductWhereInput;

/** Biến thể demo, cộng mọi biến thể khác nằm dưới sản phẩm demo: giờ vàng chỉ lọc `variation.isActive`, không xét sản phẩm cha. */
export const DEMO_VARIATION_WHERE = {
  OR: [{ pancakeId: { in: [...DEMO_VARIATION_PANCAKE_IDS] } }, { product: DEMO_PRODUCT_WHERE }],
} satisfies Prisma.VariationWhereInput;
