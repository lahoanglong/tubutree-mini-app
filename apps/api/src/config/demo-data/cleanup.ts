import type { Prisma, PrismaClient } from '@prisma/client';
import { PUBLIC_PRODUCT_WHERE } from '../../modules/catalog/public-product';
import {
  DEMO_BRANDS,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_COUPON_SELECT,
  DEMO_MIGRATION,
  DEMO_PRODUCTS,
  DEMO_PRODUCTS_LOADED_AT,
  DEMO_PRODUCT_PANCAKE_IDS,
  DEMO_PRODUCT_WHERE,
  DEMO_VARIATIONS,
  DEMO_VARIATION_PANCAKE_IDS,
  DEMO_VARIATION_WHERE,
  classifyDemoCoupon,
  demoCouponTermsMatch,
  isDemoCouponKind,
  type DemoCouponKind,
} from './demo-catalog';

/**
 * Dọn dữ liệu demo của migration 20260616000000 (logic; CLI ở `prisma/cleanup-demo-data.ts`).
 *
 * Sản phẩm và biến thể chỉ TẮT (isActive=false), không xoá: đơn, đánh giá, giỏ, giờ vàng còn trỏ tới chúng. Các đường khách
 * thấy hoặc mua hàng đều bỏ hàng đã tắt (PUBLIC_PRODUCT_WHERE, SELLABLE_VARIATION_WHERE hoặc isActive): catalog, tìm kiếm,
 * PDP, danh mục, nhãn, gian hàng, sitemap, yêu thích, giờ vàng đang chạy và sắp tới, mua chung, giỏ/checkout, tin nhắc giờ
 * vàng, giảm giá, mua lại, mời đánh giá, giỏ bỏ quên, chip sản phẩm trên bài cộng đồng; race spec `demo-cleanup` kiểm. Chỗ còn hở đã
 * biết ghi ở runbook bước 7c. pancakeHold để nguyên NULL = "admin tắt": đồng bộ Pancake không tự bật lại. SKU demo đổi
 * thành `DEMO-<sku>` để trả SKU gốc. Mã giảm giá chỉ đổi khi có `--coupons=expire` (trừ mã ghi ở `--keep-coupon`), vì chủ
 * dự án có thể giữ WELCOME30 làm mã ra mắt. Danh mục và nhãn giữ nguyên, chỉ báo.
 */

export type CouponMode = 'keep' | 'expire';

export interface CleanupArgs {
  apply: boolean;
  coupons: CouponMode;
  /** Mã demo chủ dự án duyệt giữ khi tắt các mã còn lại (`--keep-coupon=WELCOME30`). */
  keepCoupons: string[];
  /** Tên DB người chạy xác nhận (`--expect-db=tubutree`); bắt buộc khi `--apply`, CLI so với DB trong DATABASE_URL. */
  expectDb: string | null;
}

const USAGE = 'Dùng: [--apply --expect-db=<tên DB>] [--coupons=keep|expire] [--keep-coupon=MÃ,...]';

export function parseCleanupArgs(argv: readonly string[]): CleanupArgs {
  const args: CleanupArgs = { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null };
  const demoCodes = new Set(DEMO_COUPONS.map((c) => c.code));
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--apply') args.apply = true;
    else if (a === '--coupons=expire') args.coupons = 'expire';
    else if (a === '--coupons=keep') args.coupons = 'keep';
    else if (a.startsWith('--expect-db=')) {
      const name = a.slice('--expect-db='.length).trim();
      if (!name) throw new Error(`--expect-db cần tên DB. ${USAGE}`);
      args.expectDb = name;
    }
    else if (a.startsWith('--keep-coupon=')) {
      for (const raw of a.slice('--keep-coupon='.length).split(',')) {
        const code = raw.trim().toUpperCase();
        if (!code) continue;
        if (!demoCodes.has(code)) throw new Error(`--keep-coupon chỉ nhận mã demo (${[...demoCodes].join(', ')}), nhận được "${raw.trim()}".`);
        if (!args.keepCoupons.includes(code)) args.keepCoupons.push(code);
      }
    } else throw new Error(`Tham số không hiểu: "${a}". ${USAGE}`);
  }
  if (args.keepCoupons.length > 0 && args.coupons !== 'expire') {
    throw new Error('--keep-coupon chỉ dùng kèm --coupons=expire (mặc định đã giữ mọi mã).');
  }
  if (args.apply && !args.expectDb) {
    throw new Error('--apply cần --expect-db=<tên DB> (tên DB in ở dòng "DB:" của bản xem trước) để chắc chắn ghi đúng DB.');
  }
  return args;
}

/** Tên DB trong DATABASE_URL (phần đường dẫn), null khi không đọc được. */
export function databaseNameOf(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    return name || null;
  } catch {
    return null;
  }
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
  /** `migration`/`seed` là mã demo, `--coupons=expire` đổi; `name-only` (chỉ trùng mã, điều kiện khác) không đụng. */
  kind: DemoCouponKind;
  /**
   * Đúng dòng migration (id khớp) nhưng điều kiện đã bị sửa (vd chủ shop nâng WELCOME30 lên 50.000đ để dùng thật). Vẫn là mã
   * demo, `--coupons=expire` vẫn tắt; bản xem trước nhắc kiểm tay và dùng `--keep-coupon` nếu là mã thật.
   */
  termsChanged: boolean;
  isActive: boolean;
  endAt: Date;
  /** Khách còn dùng được: isActive và chưa quá endAt. */
  live: boolean;
  /** `--coupons=expire` sẽ đổi dòng này (đang bật, hoặc hạn còn ở tương lai). */
  willExpire: boolean;
  refs: CouponRefs;
}

export interface DemoCleanupPlan {
  /**
   * `editedAfterLoad`: sản phẩm demo còn đang bán mà updatedAt muộn hơn lúc migration nạp, tức có người sửa qua ứng dụng
   * (có thể đã dùng làm hàng thật). Chỉ báo để kiểm tay, `--apply` vẫn tắt.
   */
  products: {
    expected: number;
    found: number;
    active: number;
    idMismatch: Array<{ id: string; pancakeId: string }>;
    editedAfterLoad: Array<{ id: string; pancakeId: string; name: string; updatedAt: Date }>;
  };
  /**
   * `extraActive`: biến thể đang bán nằm dưới sản phẩm demo nhưng không có trong migration (thêm sau); cũng bị tắt.
   * `skuToPrefix`: biến thể demo (theo danh sách migration) còn giữ SKU gốc, `--apply` đổi thành `DEMO-<sku>`.
   */
  variations: { expected: number; found: number; active: number; extraActive: number; skuToPrefix: number };
  references: Array<{ label: string; table: string; rows: number; detail?: string }>;
  coupons: DemoCouponRow[];
  categories: Array<{ id: string; slug: string; exists: boolean; publicDemo: number; publicNonDemo: number }>;
  brands: Array<{ id: string; name: string; exists: boolean; isPublished: boolean; nonDemoActive: number }>;
}

export interface CleanupResult {
  productsDeactivated: number;
  variationsDeactivated: number;
  skusPrefixed: number;
  /** Số dòng mã thật sự đổi (isActive hoặc endAt). */
  couponsExpired: number;
  /** Đúng những dòng lần chạy này đã đổi, kèm giá trị cũ của mã: đủ để `formatUndoSql` hoàn tác. */
  undo: {
    productIds: string[];
    variationIds: string[];
    skuVariationIds: string[];
    coupons: Array<{ id: string; code: string; isActive: boolean; endAt: Date }>;
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * `variations.sku` là unique. Pancake có SKU thật trùng SKU demo (vd FUWA-DW-1L) thì mỗi lượt đồng bộ ném P2002 khi tạo
 * biến thể thật, nên `--apply` trả SKU lại bằng cách thêm tiền tố. Chỉ biến thể trong danh sách migration (pancakeId
 * `seed-...` không có trên Pancake, đồng bộ không ghi đè).
 */
export const DEMO_SKU_PREFIX = 'DEMO-';

/** `pancakeId NOT IN (...)` bỏ luôn dòng NULL (hàng đối tác tự giao), nên phải nêu NULL riêng. */
const NON_DEMO_PRODUCT_WHERE = {
  OR: [{ pancakeId: null }, { pancakeId: { notIn: [...DEMO_PRODUCT_PANCAKE_IDS] } }],
} satisfies Prisma.ProductWhereInput;

/** Chỉ đọc. Gọi tuần tự để chạy được trong một transaction (READ ONLY khi xem trước). */
export async function planDemoCleanup(db: Db, now: Date = new Date()): Promise<DemoCleanupPlan> {
  const products = await db.product.findMany({
    where: DEMO_PRODUCT_WHERE,
    select: { id: true, pancakeId: true, isActive: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  const migrationIdByPancake = new Map(DEMO_PRODUCTS.map((p) => [p.pancakeId, p.id]));
  const idMismatch = products
    .filter((p) => migrationIdByPancake.get(p.pancakeId!) !== p.id)
    .map((p) => ({ id: p.id, pancakeId: p.pancakeId! }));

  const variations = await db.variation.findMany({ where: DEMO_VARIATION_WHERE, select: { id: true, pancakeId: true, isActive: true, sku: true } });
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

  const couponRows = await db.coupon.findMany({
    where: { code: { in: DEMO_COUPONS.map((c) => c.code) } },
    select: { ...DEMO_COUPON_SELECT, isActive: true, startAt: true, endAt: true },
    orderBy: { code: 'asc' },
  });
  const coupons: DemoCouponRow[] = [];
  for (const c of couponRows) {
    const kind = classifyDemoCoupon(c)!;
    coupons.push({
      id: c.id,
      code: c.code,
      kind,
      termsChanged: kind === 'migration' && !demoCouponTermsMatch(c),
      isActive: c.isActive,
      endAt: c.endAt,
      live: c.isActive && c.endAt >= now,
      // Cùng điều kiện với --apply: mã đã tắt chỉ còn đổi khi cắt được hạn (đã tới ngày bắt đầu, hạn còn ở tương lai).
      willExpire: isDemoCouponKind(kind) && (c.isActive || (c.endAt > now && c.startAt <= now)),
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
    products: {
      expected: DEMO_PRODUCTS.length,
      found: products.length,
      active: products.filter((p) => p.isActive).length,
      idMismatch,
      editedAfterLoad: products
        .filter((p) => p.isActive && p.updatedAt > DEMO_PRODUCTS_LOADED_AT)
        .map((p) => ({ id: p.id, pancakeId: p.pancakeId!, name: p.name, updatedAt: p.updatedAt })),
    },
    variations: {
      expected: DEMO_VARIATIONS.length,
      found: variations.filter(isListed).length,
      active: variations.filter((v) => isListed(v) && v.isActive).length,
      extraActive: variations.filter((v) => !isListed(v) && v.isActive).length,
      skuToPrefix: variations.filter((v) => isListed(v) && !v.sku.startsWith(DEMO_SKU_PREFIX)).length,
    },
    references,
    coupons,
    categories,
    brands,
  };
}

/** DB "có demo" khi còn sản phẩm/biến thể demo hoặc mã demo (của migration hay do seed tạo). Chỉ trùng tên mã thì không. */
export function hasDemoData(plan: DemoCleanupPlan): boolean {
  return plan.products.found > 0 || plan.variations.found > 0 || plan.coupons.some((c) => isDemoCouponKind(c.kind));
}

export class NoDemoDataError extends Error {
  constructor() {
    super(
      `Không tìm thấy sản phẩm, biến thể hay mã giảm giá demo nào (của migration ${DEMO_MIGRATION} hoặc do seed tạo): DB này không có dữ liệu demo. Không làm gì.`,
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
  opts: { coupons: CouponMode; keepCoupons?: readonly string[]; now?: Date },
): Promise<{ plan: DemoCleanupPlan; result: CleanupResult }> {
  const now = opts.now ?? new Date();
  const keep = opts.keepCoupons ?? [];
  return prisma.$transaction(
    async (tx) => {
      const plan = await planDemoCleanup(tx, now);
      if (!hasDemoData(plan)) throw new NoDemoDataError();
      // Ghi lại id từng dòng trước khi đổi rồi đổi theo đúng id đó: số in ra và khối hoàn tác khớp đúng dòng đã đổi.
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
      const productIds = ids(await tx.product.findMany({ where: { ...DEMO_PRODUCT_WHERE, isActive: true }, select: { id: true } }));
      const variationIds = ids(await tx.variation.findMany({ where: { ...DEMO_VARIATION_WHERE, isActive: true }, select: { id: true } }));
      const skuVariationIds = ids(
        await tx.variation.findMany({
          where: { pancakeId: { in: [...DEMO_VARIATION_PANCAKE_IDS] }, NOT: { sku: { startsWith: DEMO_SKU_PREFIX } } },
          select: { id: true },
        }),
      );
      const products = await tx.product.updateMany({ where: { id: { in: productIds }, isActive: true }, data: { isActive: false } });
      const variations = await tx.variation.updateMany({ where: { id: { in: variationIds }, isActive: true }, data: { isActive: false } });
      const skusPrefixed = await tx.$executeRawUnsafe(
        `UPDATE "variations" SET "sku" = $1 || "sku" WHERE "id" = ANY($2::text[]) AND "sku" NOT LIKE $3`,
        DEMO_SKU_PREFIX,
        skuVariationIds,
        `${DEMO_SKU_PREFIX}%`,
      );
      const undoCoupons: CleanupResult['undo']['coupons'] = [];
      const couponIds = plan.coupons.filter((c) => isDemoCouponKind(c.kind) && !keep.includes(c.code)).map((c) => c.id);
      if (opts.coupons === 'expire' && couponIds.length > 0) {
        const rows = await tx.coupon.findMany({
          where: { id: { in: couponIds } },
          select: { id: true, code: true, isActive: true, startAt: true, endAt: true },
          orderBy: { code: 'asc' },
        });
        for (const c of rows) {
          // Cắt cả hạn: trang nhãn (gắn mã vào khuyến mãi, nút chép mã) chỉ xét hạn, không xét isActive. Mã chưa tới
          // ngày bắt đầu thì giữ hạn (endAt trước startAt là dòng vô nghĩa), chỉ tắt.
          const endAt = c.endAt > now && c.startAt <= now ? now : c.endAt;
          if (!c.isActive && endAt === c.endAt) continue;
          await tx.coupon.update({ where: { id: c.id }, data: { isActive: false, endAt } });
          undoCoupons.push({ id: c.id, code: c.code, isActive: c.isActive, endAt: c.endAt });
        }
      }
      const couponsExpired = undoCoupons.length;
      return {
        plan,
        result: {
          productsDeactivated: products.count,
          variationsDeactivated: variations.count,
          skusPrefixed,
          couponsExpired,
          undo: { productIds, variationIds, skuVariationIds, coupons: undoCoupons },
        },
      };
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
  if (p.editedAfterLoad.length > 0) {
    L.push(
      `   KIỂM TAY TRƯỚC KHI APPLY: ${p.editedAfterLoad.length} sản phẩm demo đang bán đã được sửa sau lúc migration nạp (${DEMO_PRODUCTS_LOADED_AT.toISOString()}); có thể ai đó đã dùng làm hàng thật. --apply vẫn tắt các sản phẩm này:`,
    );
    for (const e of p.editedAfterLoad) L.push(`   - ${e.name} (${e.pancakeId}, id ${e.id}), sửa lần cuối ${e.updatedAt.toISOString()}`);
  }

  const v = plan.variations;
  L.push(`2. Biến thể demo: tìm thấy ${v.found}/${v.expected}, đang bán ${v.active} → ${v.active > 0 ? `sẽ TẮT ${v.active}` : 'không cần đổi'}`);
  if (v.extraActive > 0) L.push(`   cộng ${v.extraActive} biến thể khác đang bán nằm dưới sản phẩm demo (thêm sau migration) → sẽ TẮT theo sản phẩm cha`);
  L.push(
    `   SKU: ${v.skuToPrefix > 0 ? `sẽ đổi ${v.skuToPrefix} SKU demo thành ${DEMO_SKU_PREFIX}<sku> (trả SKU gốc cho hàng thật đồng bộ từ Pancake)` : 'SKU demo đã mang tiền tố, không cần đổi'}`,
  );

  L.push('3. Đang tham chiếu tới hàng demo (giữ nguyên, không xoá dòng nào):');
  const used = plan.references.filter((r) => r.rows > 0);
  if (used.length === 0) L.push('   không có');
  for (const r of used) L.push(`   - ${r.label} (${r.table}): ${r.rows} dòng${r.detail ? `, ${r.detail}` : ''}`);

  L.push(`4. Mã giảm giá demo (${args.coupons === 'expire' ? '--coupons=expire: tắt và cắt hạn về lúc chạy' : 'mặc định GIỮ NGUYÊN; thêm --coupons=expire để tắt'}):`);
  if (plan.coupons.length === 0) L.push('   không có');
  for (const c of plan.coupons) {
    const refs = `đã dùng ${c.refs.redemptions} lượt, ${c.refs.orders} đơn, ${c.refs.carts} giỏ đang gắn, ${c.refs.brandPromotions} khuyến mãi nhãn, ${c.refs.missions} nhiệm vụ`;
    const state = c.live ? `còn dùng được tới ${day(c.endAt)}` : `không dùng được (${c.isActive ? `hết hạn ${day(c.endAt)}` : 'đã tắt'})`;
    const origin =
      (c.kind === 'seed' ? ' [do seed tạo: id khác migration, điều kiện như bản demo]' : '') +
      (c.termsChanged ? ` [ĐIỀU KIỆN ĐÃ SỬA so với bản demo: kiểm tay, dùng --keep-coupon=${c.code} nếu là mã thật]` : '');
    let action: string;
    if (c.kind === 'name-only') action = 'KHÔNG ĐỤNG: trùng tên mã demo nhưng điều kiện khác (mã thật hoặc đã sửa), kiểm ở Quản trị, Mã giảm giá';
    else if (args.coupons === 'expire' && args.keepCoupons.includes(c.code)) action = `GIỮ theo --keep-coupon${c.live ? ': khách dùng được, xác nhận điều kiện đúng như chủ dự án duyệt' : ''}`;
    else if (args.coupons === 'expire') action = c.willExpire ? 'sẽ TẮT (isActive=false, endAt=lúc chạy)' : 'không cần đổi';
    else action = c.live ? 'GIỮ NGUYÊN. CẢNH BÁO: khách dùng được mã chủ dự án chưa duyệt' : 'GIỮ NGUYÊN';
    L.push(`   - ${c.code}${origin}: ${state}; ${refs} → ${action}`);
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

const sqlList = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');

/**
 * Câu SQL đưa đúng những dòng lần chạy này đã đổi về như cũ (sản phẩm, biến thể bật lại, gỡ tiền tố SKU, mã về isActive và
 * endAt cũ). In ra cuối `--apply` để lưu cùng log; chỉ trưởng kỹ thuật chạy, qua psql. Không dùng bản backup trước deploy:
 * dump đó có trước migration, khôi phục là lùi cả lần deploy.
 */
export function formatUndoSql(r: CleanupResult): string {
  const u = r.undo;
  const stmts: string[] = [];
  if (u.productIds.length > 0) stmts.push(`UPDATE "products" SET "isActive" = true WHERE "id" IN (${sqlList(u.productIds)});`);
  if (u.variationIds.length > 0) stmts.push(`UPDATE "variations" SET "isActive" = true WHERE "id" IN (${sqlList(u.variationIds)});`);
  if (u.skuVariationIds.length > 0) {
    stmts.push(
      `UPDATE "variations" SET "sku" = substr("sku", ${DEMO_SKU_PREFIX.length + 1}) WHERE "id" IN (${sqlList(u.skuVariationIds)}) AND "sku" LIKE '${DEMO_SKU_PREFIX}%';`,
    );
  }
  for (const c of u.coupons) {
    stmts.push(`UPDATE "coupons" SET "isActive" = ${c.isActive}, "endAt" = '${c.endAt.toISOString()}' WHERE "id" = ${sqlList([c.id])}; -- ${c.code}`);
  }
  if (stmts.length === 0) return '-- HOÀN TÁC: lần chạy này không đổi dòng nào.';
  return ['-- HOÀN TÁC (chỉ trưởng kỹ thuật, khi thật cần): chạy nguyên khối dưới đây qua psql.', 'BEGIN;', ...stmts, 'COMMIT;'].join('\n');
}

export function formatResult(r: CleanupResult): string {
  return `Đã tắt ${r.productsDeactivated} sản phẩm, ${r.variationsDeactivated} biến thể; đổi ${r.skusPrefixed} SKU sang ${DEMO_SKU_PREFIX}<sku>; đã tắt ${r.couponsExpired} mã giảm giá. Chạy lại go-live check để xác nhận.`;
}
