import type { Prisma, PrismaClient } from '@prisma/client';
import { PUBLIC_PRODUCT_WHERE } from '../../modules/catalog/public-product';
import {
  DEMO_BRANDS,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_MIGRATION,
  DEMO_PRODUCTS,
  DEMO_PRODUCT_PANCAKE_IDS,
  DEMO_PRODUCT_WHERE,
  DEMO_VARIATIONS,
  DEMO_VARIATION_PANCAKE_IDS,
  DEMO_VARIATION_WHERE,
} from './demo-catalog';

/**
 * Dọn dữ liệu demo của migration 20260616000000 (logic; CLI ở `prisma/cleanup-demo-data.ts`).
 *
 * Sản phẩm và biến thể chỉ TẮT (isActive=false), không xoá: đơn, đánh giá, giỏ, giờ vàng còn trỏ tới chúng, và mọi nơi
 * khách thấy hoặc đặt hàng (catalog, tìm kiếm, gian hàng, trang nhãn, sitemap, giờ vàng, giỏ/checkout) đều lọc isActive.
 * pancakeHold để nguyên NULL = "admin tắt": đồng bộ Pancake không tự bật lại. Mã giảm giá chỉ đổi khi có
 * `--coupons=expire`, vì chủ dự án có thể giữ WELCOME30 làm mã ra mắt. Danh mục và nhãn giữ nguyên, chỉ báo.
 */

export type CouponMode = 'keep' | 'expire';

export interface CleanupArgs {
  apply: boolean;
  coupons: CouponMode;
}

export function parseCleanupArgs(argv: readonly string[]): CleanupArgs {
  const args: CleanupArgs = { apply: false, coupons: 'keep' };
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--apply') args.apply = true;
    else if (a === '--coupons=expire') args.coupons = 'expire';
    else if (a === '--coupons=keep') args.coupons = 'keep';
    else throw new Error(`Tham số không hiểu: "${a}". Dùng: [--apply] [--coupons=keep|expire]`);
  }
  return args;
}

export interface CouponRefs {
  redemptions: number;
  orders: number;
  carts: number;
  brandPromotions: number;
  missions: number;
}

export interface DemoCouponRow {
  id: string;
  code: string;
  /** id cũng khớp dòng migration tạo. Chỉ những mã này mới bị `--coupons=expire` đổi. */
  fromMigration: boolean;
  isActive: boolean;
  endAt: Date;
  /** Khách còn dùng được: isActive và chưa quá endAt. */
  live: boolean;
  /** `--coupons=expire` sẽ đổi dòng này (đang bật, hoặc hạn còn ở tương lai). */
  willExpire: boolean;
  refs: CouponRefs;
}

export interface DemoCleanupPlan {
  products: { expected: number; found: number; active: number; idMismatch: Array<{ id: string; pancakeId: string }> };
  /** `extraActive`: biến thể đang bán nằm dưới sản phẩm demo nhưng không có trong migration (thêm sau); cũng bị tắt. */
  variations: { expected: number; found: number; active: number; extraActive: number };
  references: Array<{ label: string; table: string; rows: number; detail?: string }>;
  coupons: DemoCouponRow[];
  categories: Array<{ id: string; slug: string; exists: boolean; publicDemo: number; publicNonDemo: number }>;
  brands: Array<{ id: string; name: string; exists: boolean; isPublished: boolean; nonDemoActive: number }>;
}

export interface CleanupResult {
  productsDeactivated: number;
  variationsDeactivated: number;
  couponsExpired: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** `pancakeId NOT IN (...)` bỏ luôn dòng NULL (hàng đối tác tự giao), nên phải nêu NULL riêng. */
const NON_DEMO_PRODUCT_WHERE = {
  OR: [{ pancakeId: null }, { pancakeId: { notIn: [...DEMO_PRODUCT_PANCAKE_IDS] } }],
} satisfies Prisma.ProductWhereInput;

const MIGRATION_COUPON_WHERE = {
  OR: DEMO_COUPONS.map((c) => ({ id: c.id, code: c.code })),
} satisfies Prisma.CouponWhereInput;

function couponExpireWhere(now: Date): Prisma.CouponWhereInput {
  return { ...MIGRATION_COUPON_WHERE, AND: [{ OR: [{ isActive: true }, { endAt: { gt: now } }] }] };
}

/** Chỉ đọc. Gọi tuần tự để chạy được trong một transaction (READ ONLY khi xem trước). */
export async function planDemoCleanup(db: Db, now: Date = new Date()): Promise<DemoCleanupPlan> {
  const products = await db.product.findMany({ where: DEMO_PRODUCT_WHERE, select: { id: true, pancakeId: true, isActive: true } });
  const migrationIdByPancake = new Map(DEMO_PRODUCTS.map((p) => [p.pancakeId, p.id]));
  const idMismatch = products
    .filter((p) => migrationIdByPancake.get(p.pancakeId!) !== p.id)
    .map((p) => ({ id: p.id, pancakeId: p.pancakeId! }));

  const variations = await db.variation.findMany({ where: DEMO_VARIATION_WHERE, select: { id: true, pancakeId: true, isActive: true } });
  const demoVarPancake = new Set(DEMO_VARIATION_PANCAKE_IDS);
  const isListed = (v: { pancakeId: string | null }) => v.pancakeId !== null && demoVarPancake.has(v.pancakeId);

  const productIds = products.map((p) => p.id);
  const variationIds = variations.map((v) => v.id);
  const byProduct = { productId: { in: productIds } };
  const byVariation = { variationId: { in: variationIds } };

  const orderLines = await db.orderItem.findMany({ where: byVariation, select: { orderId: true } });
  const openSubs = await db.subscription.count({ where: { ...byVariation, status: { in: ['ACTIVE', 'PAUSED'] } } });
  const references: DemoCleanupPlan['references'] = [
    { label: 'dòng đơn hàng', table: 'order_items', rows: orderLines.length, detail: `${new Set(orderLines.map((l) => l.orderId)).size} đơn` },
    { label: 'giỏ hàng', table: 'cart_items', rows: await db.cartItem.count({ where: byVariation }) },
    { label: 'giờ vàng', table: 'flash_sale_items', rows: await db.flashSaleItem.count({ where: byVariation }) },
    { label: 'gói định kỳ', table: 'subscriptions', rows: await db.subscription.count({ where: byVariation }), detail: `${openSubs} đang chạy hoặc tạm dừng: kỳ sau sẽ báo ngừng bán, CSKH xử lý tay` },
    { label: 'nhắc mua lại', table: 'reorder_reminders', rows: await db.reorderReminder.count({ where: byVariation }) },
    { label: 'lịch sử giá đại lý', table: 'dealer_price_history', rows: await db.dealerPriceHistory.count({ where: byVariation }) },
    { label: 'gian hàng CTV/đối tác', table: 'storefront_items', rows: await db.storefrontItem.count({ where: { OR: [byProduct, byVariation] } }) },
    { label: 'liên kết Pancake của đối tác', table: 'merchant_pancake_links', rows: await db.merchantPancakeLink.count({ where: { OR: [byProduct, byVariation] } }) },
    { label: 'đánh giá', table: 'reviews', rows: await db.review.count({ where: byProduct }) },
    { label: 'yêu thích', table: 'wishlists', rows: await db.wishlist.count({ where: byProduct }) },
    { label: 'mua chung', table: 'group_buys', rows: await db.groupBuy.count({ where: byProduct }) },
    { label: 'gắn bài cộng đồng', table: 'post_product_tags', rows: await db.postProductTag.count({ where: byProduct }) },
    { label: 'bộ nội dung CTV', table: 'product_content_kits', rows: await db.productContentKit.count({ where: byProduct }) },
    { label: 'bản sửa chờ duyệt', table: 'product_edit_drafts', rows: await db.productEditDraft.count({ where: byProduct }) },
  ];

  const migrationCouponIds = new Set(DEMO_COUPONS.map((c) => c.id));
  const couponRows = await db.coupon.findMany({
    where: { code: { in: DEMO_COUPONS.map((c) => c.code) } },
    select: { id: true, code: true, isActive: true, endAt: true },
    orderBy: { code: 'asc' },
  });
  const coupons: DemoCouponRow[] = [];
  for (const c of couponRows) {
    const fromMigration = migrationCouponIds.has(c.id);
    coupons.push({
      ...c,
      fromMigration,
      live: c.isActive && c.endAt >= now,
      willExpire: fromMigration && (c.isActive || c.endAt > now),
      refs: {
        redemptions: await db.couponRedemption.count({ where: { couponId: c.id } }),
        orders: await db.order.count({ where: { couponCode: c.code } }),
        carts: await db.cart.count({ where: { couponCode: c.code } }),
        brandPromotions: await db.brandPromotion.count({ where: { couponCode: c.code } }),
        missions: await db.mission.count({ where: { rewardCoupon: c.code } }),
      },
    });
  }

  const categories: DemoCleanupPlan['categories'] = [];
  for (const c of DEMO_CATEGORIES) {
    const inCat = { ...PUBLIC_PRODUCT_WHERE, categoryIds: { has: c.id } };
    categories.push({
      ...c,
      exists: (await db.category.count({ where: { id: c.id } })) > 0,
      publicDemo: await db.product.count({ where: { ...inCat, ...DEMO_PRODUCT_WHERE } }),
      publicNonDemo: await db.product.count({ where: { ...inCat, ...NON_DEMO_PRODUCT_WHERE } }),
    });
  }

  const brands: DemoCleanupPlan['brands'] = [];
  for (const b of DEMO_BRANDS) {
    const row = await db.brand.findUnique({ where: { id: b.id }, select: { isPublished: true } });
    brands.push({
      ...b,
      exists: row !== null,
      isPublished: row?.isPublished ?? false,
      nonDemoActive: await db.product.count({ where: { brandId: b.id, isActive: true, ...NON_DEMO_PRODUCT_WHERE } }),
    });
  }

  return {
    products: { expected: DEMO_PRODUCTS.length, found: products.length, active: products.filter((p) => p.isActive).length, idMismatch },
    variations: {
      expected: DEMO_VARIATIONS.length,
      found: variations.filter(isListed).length,
      active: variations.filter((v) => isListed(v) && v.isActive).length,
      extraActive: variations.filter((v) => !isListed(v) && v.isActive).length,
    },
    references,
    coupons,
    categories,
    brands,
  };
}

/** DB "có demo" khi còn ít nhất một dòng do migration tạo. Chỉ trùng mã (id khác) thì không: có thể là mã thật. */
export function hasDemoData(plan: DemoCleanupPlan): boolean {
  return plan.products.found > 0 || plan.variations.found > 0 || plan.coupons.some((c) => c.fromMigration);
}

export class NoDemoDataError extends Error {
  constructor() {
    super(
      `Không tìm thấy sản phẩm, biến thể hay mã nào do migration ${DEMO_MIGRATION} tạo: DB này không phải loại có dữ liệu demo. Không làm gì.`,
    );
    this.name = 'NoDemoDataError';
  }
}

/** Xem trước trong transaction READ ONLY: lệnh ghi nào lọt vào cũng bị Postgres từ chối. */
export async function previewDemoCleanup(prisma: PrismaClient, now: Date = new Date()): Promise<DemoCleanupPlan> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return planDemoCleanup(tx, now);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Lập lại kế hoạch và đổi trong CÙNG một transaction: điều in ra đúng là điều đã áp. Chạy lại không lỗi (chỉ đổi dòng còn
 * đang bật). Ném NoDemoDataError khi DB không có dòng demo nào.
 */
export async function applyDemoCleanup(
  prisma: PrismaClient,
  opts: { coupons: CouponMode; now?: Date },
): Promise<{ plan: DemoCleanupPlan; result: CleanupResult }> {
  const now = opts.now ?? new Date();
  return prisma.$transaction(
    async (tx) => {
      const plan = await planDemoCleanup(tx, now);
      if (!hasDemoData(plan)) throw new NoDemoDataError();
      const products = await tx.product.updateMany({ where: { ...DEMO_PRODUCT_WHERE, isActive: true }, data: { isActive: false } });
      const variations = await tx.variation.updateMany({ where: { ...DEMO_VARIATION_WHERE, isActive: true }, data: { isActive: false } });
      let couponsExpired = 0;
      if (opts.coupons === 'expire') {
        couponsExpired = await tx.coupon.count({ where: couponExpireWhere(now) });
        await tx.coupon.updateMany({ where: { ...MIGRATION_COUPON_WHERE, isActive: true }, data: { isActive: false } });
        // Cắt cả hạn: trang nhãn (gắn mã vào khuyến mãi, nút chép mã) chỉ xét hạn, không xét isActive.
        await tx.coupon.updateMany({ where: { ...MIGRATION_COUPON_WHERE, endAt: { gt: now }, startAt: { lte: now } }, data: { endAt: now } });
      }
      return { plan, result: { productsDeactivated: products.count, variationsDeactivated: variations.count, couponsExpired } };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function formatPlan(plan: DemoCleanupPlan, args: CleanupArgs): string {
  const L: string[] = [];
  L.push(`Dọn dữ liệu demo của migration ${DEMO_MIGRATION}`);
  L.push(
    args.apply
      ? `Chế độ: THỰC HIỆN trong một transaction (mã giảm giá: ${args.coupons === 'expire' ? 'TẮT' : 'giữ nguyên'}).`
      : 'Chế độ: XEM TRƯỚC, không ghi gì. Đọc kỹ rồi chạy lại với --apply.',
  );

  const p = plan.products;
  L.push('', `1. Sản phẩm demo: tìm thấy ${p.found}/${p.expected}, đang bán ${p.active} → ${p.active > 0 ? `sẽ TẮT ${p.active} (isActive=false, không xoá)` : 'không cần đổi'}`);
  for (const m of p.idMismatch) L.push(`   lưu ý: ${m.pancakeId} mang id ${m.id}, khác id trong migration (DB từng chạy seed?); vẫn là hàng demo, vẫn tắt`);

  const v = plan.variations;
  L.push(`2. Biến thể demo: tìm thấy ${v.found}/${v.expected}, đang bán ${v.active} → ${v.active > 0 ? `sẽ TẮT ${v.active}` : 'không cần đổi'}`);
  if (v.extraActive > 0) L.push(`   cộng ${v.extraActive} biến thể khác đang bán nằm dưới sản phẩm demo (thêm sau migration) → sẽ TẮT theo sản phẩm cha`);

  L.push('3. Đang tham chiếu tới hàng demo (giữ nguyên, không xoá dòng nào):');
  const used = plan.references.filter((r) => r.rows > 0);
  if (used.length === 0) L.push('   không có');
  for (const r of used) L.push(`   - ${r.label} (${r.table}): ${r.rows} dòng${r.detail ? `, ${r.detail}` : ''}`);

  L.push(`4. Mã giảm giá demo (${args.coupons === 'expire' ? '--coupons=expire: tắt và cắt hạn về lúc chạy' : 'mặc định GIỮ NGUYÊN; thêm --coupons=expire để tắt'}):`);
  if (plan.coupons.length === 0) L.push('   không có');
  for (const c of plan.coupons) {
    const refs = `đã dùng ${c.refs.redemptions} lượt, ${c.refs.orders} đơn, ${c.refs.carts} giỏ đang gắn, ${c.refs.brandPromotions} khuyến mãi nhãn, ${c.refs.missions} nhiệm vụ`;
    const state = c.live ? `còn dùng được tới ${day(c.endAt)}` : `không dùng được (${c.isActive ? `hết hạn ${day(c.endAt)}` : 'đã tắt'})`;
    let action: string;
    if (!c.fromMigration) action = 'KHÔNG ĐỤNG: trùng mã nhưng id khác dòng migration tạo (seed hoặc tạo tay), xem ở Quản trị';
    else if (args.coupons === 'expire') action = c.willExpire ? 'sẽ TẮT (isActive=false, endAt=lúc chạy)' : 'không cần đổi';
    else action = c.live ? 'GIỮ NGUYÊN. CẢNH BÁO: khách dùng được mã chủ dự án chưa duyệt' : 'GIỮ NGUYÊN';
    L.push(`   - ${c.code}: ${state}; ${refs} → ${action}`);
  }

  L.push('5. Danh mục demo (giữ nguyên):');
  for (const c of plan.categories) {
    if (!c.exists) {
      L.push(`   - ${c.id} (${c.slug}): không có trong DB`);
      continue;
    }
    const after = c.publicNonDemo;
    L.push(`   - ${c.id} (${c.slug}): ${c.publicDemo} SP demo + ${c.publicNonDemo} SP khác đang hiện → sau khi tắt còn ${after}${after === 0 ? ' → TRỐNG (miniapp tự ẩn danh mục trống)' : ''}`);
  }

  L.push('6. Nhãn hàng do migration 20260626020000_brand_backfill tạo từ tên nhãn demo (giữ nguyên):');
  for (const b of plan.brands) {
    if (!b.exists) {
      L.push(`   - ${b.name}: không có trong DB`);
      continue;
    }
    L.push(`   - ${b.name}: ${b.isPublished ? 'ĐANG CÔNG KHAI' : 'chưa công khai'}, ${b.nonDemoActive} SP thật đang bán${b.isPublished && b.nonDemoActive === 0 ? ' → trang nhãn sẽ trống' : ''}`);
  }
  return L.join('\n');
}

export function formatResult(r: CleanupResult): string {
  return `Đã tắt ${r.productsDeactivated} sản phẩm, ${r.variationsDeactivated} biến thể; đã tắt ${r.couponsExpired} mã giảm giá. Chạy lại go-live check để xác nhận.`;
}
