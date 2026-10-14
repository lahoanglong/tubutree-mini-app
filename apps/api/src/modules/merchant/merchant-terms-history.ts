import type { Prisma } from '@prisma/client';
import { DEFAULT_MERCHANT_COMMISSION_PCT } from './merchant-config';

export const MERCHANT_COMMISSION_KEY = 'merchant.commission_pct';

/** Khoá tư vấn theo gian hàng khi đổi mức phí — updateStoreTerms và lúc đổi phí sàn mặc định giữ cùng khoá. */
export const termsLockKey = (storefrontId: string) => `merchant-terms:${storefrontId}`;

/** Phí sàn mặc định từ giá trị lưu ở SystemConfig; thiếu hoặc sai kiểu thì theo mặc định trong mã. */
export function commissionPctOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_MERCHANT_COMMISSION_PCT;
}

/** Phí sàn mặc định đang lưu, đọc thẳng DB trong transaction (bộ nhớ đệm của SystemConfigService có thể cũ tới 60 giây). */
export async function defaultCommissionPctIn(tx: Prisma.TransactionClient): Promise<number> {
  const row = await tx.systemConfig.findUnique({ where: { key: MERCHANT_COMMISSION_KEY }, select: { value: true } });
  return commissionPctOf(row?.value);
}

/**
 * Phí sàn mặc định đổi từ `oldPct` sang `newPct`: mỗi gian hàng đối tác đang theo mặc định (commissionPct NULL) có thêm một dòng
 * lịch sử mức mới hiệu lực từ `at`; gian hàng chưa có lịch sử thì ghi trước mốc gốc mức cũ. Hàng giao hộ chốt phí theo lúc đặt
 * đơn (termsAt), nên đơn đã đặt giữ mức cũ dù phiếu lập sau. Gọi trong transaction ghi khoá cấu hình; khoá từng gian hàng như
 * updateStoreTerms để không chen giữa một lần admin sửa phí riêng.
 */
export async function freezeDefaultCommissionChange(
  tx: Prisma.TransactionClient,
  oldPct: number,
  newPct: number,
  at: Date,
  changedById: string,
): Promise<number> {
  if (oldPct === newPct) return 0;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('merchant-terms:' || s.id))
      FROM (SELECT id FROM storefronts WHERE type = 'MERCHANT' AND "commissionPct" IS NULL ORDER BY id) s`;
  const stores = await tx.$queryRaw<{ id: string; consignmentFeePct: Prisma.Decimal | number; consignmentFeeFixed: number }[]>`
    SELECT id, "consignmentFeePct", "consignmentFeeFixed" FROM storefronts
     WHERE type = 'MERCHANT' AND "commissionPct" IS NULL ORDER BY id FOR UPDATE`;
  if (stores.length === 0) return 0;
  const ids = stores.map((s) => s.id);
  const withHistory = new Set(
    (await tx.storefrontTermsHistory.groupBy({ by: ['storefrontId'], where: { storefrontId: { in: ids } } })).map((r) => r.storefrontId),
  );
  const rows: Prisma.StorefrontTermsHistoryCreateManyInput[] = [];
  for (const s of stores) {
    const fees = { consignmentFeePct: Number(s.consignmentFeePct), consignmentFeeFixed: s.consignmentFeeFixed };
    if (!withHistory.has(s.id)) rows.push({ storefrontId: s.id, commissionPct: oldPct, ...fees, effectiveFrom: new Date(0) });
    rows.push({ storefrontId: s.id, commissionPct: newPct, ...fees, effectiveFrom: at, changedById });
  }
  await tx.storefrontTermsHistory.createMany({ data: rows });
  return stores.length;
}
