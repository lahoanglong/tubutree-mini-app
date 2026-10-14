import { ConflictException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PANCAKE_FULFILLED_VARIATION_WHERE } from '../integrations/pancake/pancake-fulfilment';

type Db = Pick<PrismaClient, 'variation' | 'product'> | Prisma.TransactionClient;

export interface LinkablePancakeVariation {
  variationId: string;
  pancakeId: string;
  productId: string;
  productName: string;
  variationName: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

/**
 * Biến thể Pancake đã đồng bộ mà gian hàng được xin "Tubu giao hộ": đúng mã, đang bán, kho Tubu giao, thuộc sản phẩm Tubu
 * chưa có chủ hoặc của chính gian hàng này (docs/2026-10-14-merchant-fulfilment-design.md mục 9).
 */
export async function findLinkablePancakeVariation(
  db: Db,
  code: string,
  storefrontId: string,
): Promise<LinkablePancakeVariation | null> {
  const pancakeId = code.trim();
  if (!pancakeId) return null;
  const v = await db.variation.findFirst({
    where: {
      AND: [
        PANCAKE_FULFILLED_VARIATION_WHERE,
        { pancakeId, isActive: true, product: { OR: [{ storefrontId: null }, { storefrontId }] } },
      ],
    },
    select: {
      id: true,
      pancakeId: true,
      name: true,
      retailPrice: true,
      salePrice: true,
      stock: true,
      product: { select: { id: true, name: true } },
    },
  });
  if (!v || !v.pancakeId) return null;
  return {
    variationId: v.id,
    pancakeId: v.pancakeId,
    productId: v.product.id,
    productName: v.product.name,
    variationName: v.name,
    retailPrice: v.retailPrice,
    salePrice: v.salePrice,
    stock: v.stock,
  };
}

export const LINK_TAKEN_MESSAGE =
  'Mã biến thể Pancake này vừa được liên kết cho sản phẩm khác. Từ chối sản phẩm kèm lý do để đối tác nhập mã khác.';

/**
 * Duyệt sản phẩm "Tubu giao hộ": chuyển CHÍNH dòng biến thể Pancake sang sản phẩm của đối tác (giữ chỗ tồn, hoàn kho, đồng bộ
 * tồn Pancake vẫn theo `pancakeId` như cũ), xoá biến thể tạm, sản phẩm Tubu cũ hết biến thể thì tắt. Phải chạy trong
 * transaction cùng lần lật trạng thái duyệt: cập nhật có điều kiện `productId = sản phẩm cũ` nên hai lần duyệt cùng mã chỉ một
 * lần thắng, lần kia ném ConflictException và rollback cả lần duyệt.
 */
export async function linkTubuFulfilledVariation(
  tx: Prisma.TransactionClient,
  product: { id: string; storefrontId: string | null; pancakeLinkCode: string | null },
): Promise<void> {
  if (!product.pancakeLinkCode || !product.storefrontId) return;
  const target = await findLinkablePancakeVariation(tx, product.pancakeLinkCode, product.storefrontId);
  // Sửa nội dung đưa sản phẩm đã liên kết về chờ duyệt; lần duyệt lại không có gì để chuyển.
  if (target?.productId === product.id) return;
  if (!target) {
    const owned = await tx.variation.findFirst({
      where: { productId: product.id, pancakeId: product.pancakeLinkCode },
      select: { id: true },
    });
    if (owned) return;
    throw new ConflictException(LINK_TAKEN_MESSAGE);
  }

  const moved = await tx.variation.updateMany({
    where: { id: target.variationId, productId: target.productId },
    data: { productId: product.id },
  });
  if (moved.count === 0) throw new ConflictException(LINK_TAKEN_MESSAGE);

  await tx.variation.deleteMany({ where: { productId: product.id, pancakeId: null } });
  await tx.product.update({
    where: { id: product.id },
    data: { fulfilment: 'TUBU', basePrice: target.retailPrice, salePrice: target.salePrice },
  });
  const left = await tx.variation.count({ where: { productId: target.productId } });
  if (left === 0) {
    await tx.product.update({ where: { id: target.productId }, data: { isActive: false } });
  }
}
