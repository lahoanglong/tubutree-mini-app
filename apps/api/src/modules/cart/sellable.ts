import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LEGACY_FAKE_PANCAKE_PREFIX } from '../integrations/pancake/pancake-fulfilment';

/**
 * Một nguồn duy nhất cho câu hỏi "variation này còn đặt được không" (Q-14, C-007).
 *
 * Đủ ba điều kiện: variation đang bán, Product cha đang bán VÀ đã duyệt. SP đối tác đang chờ duyệt
 * (PENDING_REVIEW) vẫn `isActive=true` nên chỉ kiểm `isActive` là để lọt — mọi đường tạo đơn
 * (giỏ/checkout, CTV lên đơn hộ, đại lý, gói định kỳ) phải dùng chung điều kiện này.
 */
export const SELLABLE_VARIATION_WHERE = {
  isActive: true,
  product: { isActive: true, approvalStatus: 'APPROVED' },
} as const satisfies Prisma.VariationWhereInput;

/** Mã lỗi ổn định để FE nhận diện (message tiếng Việt có thể đổi câu chữ). */
export const PRODUCT_DISCONTINUED = 'PRODUCT_DISCONTINUED';

export interface SellableShape {
  isActive: boolean;
  product: { isActive: boolean; approvalStatus: string };
}

export function isSellableVariation(v: SellableShape): boolean {
  return v.isActive && v.product.isActive && v.product.approvalStatus === 'APPROVED';
}

export function productDiscontinuedError(productName?: string | null): BadRequestException {
  const message = productName
    ? `Sản phẩm "${productName}" đã ngừng bán, vui lòng xoá khỏi đơn rồi đặt lại.`
    : 'Sản phẩm đã ngừng bán, vui lòng xoá khỏi đơn rồi đặt lại.';
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code: PRODUCT_DISCONTINUED, message });
}

/**
 * Bán được VÀ kho Tubu giao qua Pancake (`isPancakeFulfilledLine`): điều kiện của các kênh tạo một đơn đẩy thẳng Pancake
 * (đại lý, gói định kỳ, CTV lên đơn hộ). Hàng đối tác tự giao chỉ đặt qua giỏ, nơi đơn được tách theo nơi giao (D4).
 */
export const SELLABLE_PANCAKE_VARIATION_WHERE = {
  isActive: true,
  pancakeId: { not: null },
  NOT: { pancakeId: { startsWith: LEGACY_FAKE_PANCAKE_PREFIX } },
  product: { isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU' },
} as const satisfies Prisma.VariationWhereInput;

export const NOT_TUBU_FULFILLED = 'NOT_TUBU_FULFILLED';

type SellableReader = Pick<Prisma.TransactionClient, 'variation'>;

/**
 * Kiểm lại TRONG transaction tạo đơn: SP có thể bị gỡ/từ chối giữa lúc tính giá và lúc ghi đơn.
 * Ném lỗi PRODUCT_DISCONTINUED (kèm tên SP đầu tiên bị loại) nếu có dòng không còn bán. `pancakeOnly`: kênh chỉ đẩy Pancake,
 * dòng do đối tác tự giao bị từ chối với mã NOT_TUBU_FULFILLED.
 */
export async function assertVariationsSellable(
  tx: SellableReader,
  lines: ReadonlyArray<{ variationId: string; productName?: string | null }>,
  opts: { pancakeOnly?: boolean } = {},
): Promise<void> {
  if (lines.length === 0) return;
  const ids = [...new Set(lines.map((l) => l.variationId))];
  const ok = await tx.variation.findMany({
    where: { id: { in: ids }, ...(opts.pancakeOnly ? SELLABLE_PANCAKE_VARIATION_WHERE : SELLABLE_VARIATION_WHERE) },
    select: { id: true },
  });
  if (ok.length === ids.length) return;
  if (opts.pancakeOnly) {
    const sellable = await tx.variation.findMany({
      where: { id: { in: ids }, ...SELLABLE_VARIATION_WHERE },
      select: { id: true },
    });
    const sellableIds = new Set(sellable.map((v) => v.id));
    const okIds = new Set(ok.map((v) => v.id));
    const merchantLine = lines.find((l) => sellableIds.has(l.variationId) && !okIds.has(l.variationId));
    if (merchantLine) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: NOT_TUBU_FULFILLED,
        message: `Sản phẩm "${merchantLine.productName ?? ''}" do gian hàng đối tác tự giao, chỉ đặt được qua giỏ hàng.`,
      });
    }
  }
  const okIds = new Set(ok.map((v) => v.id));
  const bad = lines.find((l) => !okIds.has(l.variationId));
  throw productDiscontinuedError(bad?.productName);
}

export function isProductDiscontinuedError(err: unknown): boolean {
  if (!(err instanceof BadRequestException)) return false;
  const res = err.getResponse();
  return typeof res === 'object' && res !== null && (res as { code?: string }).code === PRODUCT_DISCONTINUED;
}
