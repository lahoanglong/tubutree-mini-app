import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DEMO_COUPONS,
  DEMO_COUPON_SELECT,
  DEMO_MIGRATION,
  DEMO_PRODUCT_WHERE,
  DEMO_VARIATION_WHERE,
  classifyDemoCoupon,
  isDemoCouponKind,
  type DemoCouponKind,
} from '../demo-data/demo-catalog';
import { fail, pass, warn, type CheckResult, type Env, type GoLivePhase } from './types';

const G_DB = 'Cơ sở dữ liệu';
const CLEANUP_HINT = 'runbook mục 5, bước 7c';

/** Dữ liệu demo của migration 20260616000000 còn lại trong DB; collector điền, evaluateDemoData chỉ phân tích. */
export interface DemoDataSnapshot {
  /** Sản phẩm khớp pancakeId demo của migration: có trong DB / còn isActive. */
  products: { found: number; active: number };
  /** Biến thể demo còn isActive, gồm cả biến thể thêm sau vào sản phẩm demo. */
  activeVariations: number;
  /** Mã trùng tên mã demo còn dùng được (isActive, chưa quá endAt), kèm loại theo `classifyDemoCoupon`. */
  liveCoupons: Array<{ code: string; endAt: string; kind: DemoCouponKind }>;
}

type DemoReader = Pick<PrismaClient | Prisma.TransactionClient, 'product' | 'variation' | 'coupon'>;

/** Chỉ đọc. Gọi tuần tự vì chạy trong transaction READ ONLY của collectDbSnapshot. */
export async function collectDemoData(db: DemoReader, now: Date = new Date()): Promise<DemoDataSnapshot> {
  const found = await db.product.count({ where: DEMO_PRODUCT_WHERE });
  const active = await db.product.count({ where: { ...DEMO_PRODUCT_WHERE, isActive: true } });
  const activeVariations = await db.variation.count({ where: { ...DEMO_VARIATION_WHERE, isActive: true } });
  const coupons = await db.coupon.findMany({
    where: { code: { in: DEMO_COUPONS.map((c) => c.code) }, isActive: true, endAt: { gte: now } },
    select: { ...DEMO_COUPON_SELECT, endAt: true },
    orderBy: { code: 'asc' },
  });
  return {
    products: { found, active },
    activeVariations,
    liveCoupons: coupons.map((c) => ({ code: c.code, endAt: c.endAt.toISOString(), kind: classifyDemoCoupon(c)! })),
  };
}

function acceptedCoupons(env: Env): Set<string> {
  return new Set(
    (env.GO_LIVE_ACCEPT_DEMO_COUPONS ?? '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

const couponList = (cs: DemoDataSnapshot['liveCoupons']) => cs.map((c) => `${c.code} (hạn ${c.endAt.slice(0, 10)})`).join(', ');

/**
 * Hàm thuần: không chạm DB. Thiếu ảnh chụp (fixture cũ) thì không có dòng nào. Trước deploy chỉ WARN: dọn là bước 7c trong
 * cửa sổ deploy (API đang dừng, khách chưa thấy gì); sau deploy còn demo là FAIL.
 */
export function evaluateDemoData(s: DemoDataSnapshot | undefined, env: Env, phase: GoLivePhase = 'post-deploy'): CheckResult[] {
  if (!s) return [];
  const out: CheckResult[] = [];
  const red = (id: string, title: string, detail: string, hint: string) =>
    phase === 'pre-deploy' ? warn(G_DB, id, title, `${detail} (sẽ dọn ở ${CLEANUP_HINT})`, hint) : fail(G_DB, id, title, detail, hint);

  const pTitle = 'Sản phẩm demo của migration';
  if (s.products.active > 0 || s.activeVariations > 0) {
    out.push(
      red(
        'db.demo_products',
        pTitle,
        `${s.products.active} sản phẩm, ${s.activeVariations} biến thể demo đang bán (migration ${DEMO_MIGRATION} nạp vào mọi DB mới): khách thấy và đặt được hàng giả`,
        `Trong container api: \`pnpm run prisma:cleanup-demo\` (xem trước), đọc kết quả, rồi \`pnpm run prisma:cleanup-demo -- --apply --expect-db=<tên DB>\` (tắt, không xoá). Xem ${CLEANUP_HINT}.`,
      ),
    );
  } else if (s.products.found === 0) {
    out.push(pass(G_DB, 'db.demo_products', pTitle, 'không có (DB không nạp dữ liệu demo)'));
  } else {
    out.push(pass(G_DB, 'db.demo_products', pTitle, `${s.products.found} sản phẩm demo đều đã tắt`));
  }

  const cTitle = 'Mã giảm giá demo (migration hoặc seed)';
  const accepted = acceptedCoupons(env);
  const demo = s.liveCoupons.filter((c) => isDemoCouponKind(c.kind));
  const blocking = demo.filter((c) => !accepted.has(c.code));
  const kept = demo.filter((c) => accepted.has(c.code));
  const nameOnly = s.liveCoupons.filter((c) => c.kind === 'name-only');
  const notes = [
    kept.length > 0 ? `đã chấp nhận giữ: ${couponList(kept)}` : '',
    nameOnly.length > 0 ? `trùng tên mã demo nhưng điều kiện khác bản demo (coi là mã thật, dọn không đụng): ${couponList(nameOnly)}` : '',
  ].filter(Boolean);
  if (blocking.length > 0) {
    out.push(
      red(
        'db.demo_coupons',
        cTitle,
        `còn dùng được, chủ dự án chưa duyệt: ${couponList(blocking)}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`,
        `Không giữ: \`pnpm run prisma:cleanup-demo -- --apply --expect-db=<tên DB> --coupons=expire\` (giữ riêng mã được duyệt: thêm --keep-coupon=<mã>; ${CLEANUP_HINT}). Mã chủ dự án duyệt giữ: chạy lại go-live check với GO_LIVE_ACCEPT_DEMO_COUPONS=<mã,...> (mã đó thành WARN).`,
      ),
    );
  } else if (notes.length > 0) {
    out.push(
      warn(
        G_DB,
        'db.demo_coupons',
        cTitle,
        `còn dùng được: ${notes.join('; ')}`,
        'Mở Quản trị, Mã giảm giá: xác nhận điều kiện (giá trị, đơn tối thiểu, số lượt, hạn) của từng mã nêu trên đúng như chủ dự án duyệt.',
      ),
    );
  } else {
    out.push(pass(G_DB, 'db.demo_coupons', cTitle, 'không mã demo nào còn dùng được'));
  }
  return out;
}
