import { BadRequestException, ConflictException } from '@nestjs/common';
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
  /**
   * Biến thể đang nằm ở một sản phẩm đang bán (của Tubu hoặc nhãn khác): đối tác chỉ gửi xin được, admin phải xác nhận chuyển
   * sản phẩm đó sang gian hàng thì mới liên kết.
   */
  requiresAdminConfirm: boolean;
}

/** Kết quả nút "Kiểm tra mã" ở form đối tác: không lộ tồn kho hay mã nội bộ của sản phẩm đang bán của bên khác. */
export interface MerchantPancakeCheck {
  pancakeId: string;
  productName: string;
  variationName: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number | null;
  requiresAdminConfirm: boolean;
}

export function toMerchantPancakeCheck(v: LinkablePancakeVariation): MerchantPancakeCheck {
  return {
    pancakeId: v.pancakeId,
    productName: v.productName,
    variationName: v.variationName,
    retailPrice: v.retailPrice,
    salePrice: v.salePrice,
    stock: v.requiresAdminConfirm ? null : v.stock,
    requiresAdminConfirm: v.requiresAdminConfirm,
  };
}

const onSale = (p: { isActive: boolean; approvalStatus: string }) => p.isActive && p.approvalStatus === 'APPROVED';

/**
 * Biến thể Pancake đã đồng bộ mà gian hàng được xin "Tubu giao hộ": đúng mã, đang bán, kho Tubu giao, thuộc sản phẩm Tubu
 * chưa có chủ (hoặc đã nằm ở chính `forProductId`). Không bao giờ trả biến thể đang thuộc gian hàng nào, kể cả sản phẩm khác của
 * chính gian hàng (docs/2026-10-14-merchant-fulfilment-design.md mục 9).
 */
export async function findLinkablePancakeVariation(
  db: Db,
  code: string,
  forProductId?: string,
): Promise<LinkablePancakeVariation | null> {
  const pancakeId = code.trim();
  if (!pancakeId) return null;
  const v = await db.variation.findFirst({
    where: {
      AND: [
        PANCAKE_FULFILLED_VARIATION_WHERE,
        {
          pancakeId,
          isActive: true,
          product: { OR: [{ storefrontId: null }, ...(forProductId ? [{ id: forProductId }] : [])] },
        },
      ],
    },
    select: {
      id: true,
      pancakeId: true,
      name: true,
      retailPrice: true,
      salePrice: true,
      stock: true,
      product: { select: { id: true, name: true, storefrontId: true, isActive: true, approvalStatus: true } },
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
    requiresAdminConfirm: v.product.storefrontId === null && onSale(v.product),
  };
}

export const LINK_TAKEN_MESSAGE =
  'Mã biến thể Pancake này vừa được liên kết cho sản phẩm khác. Từ chối sản phẩm kèm lý do để đối tác nhập mã khác.';

export const PANCAKE_TAKEOVER_UNCONFIRMED = 'PANCAKE_TAKEOVER_UNCONFIRMED';

export const LEGACY_LINK_MESSAGE =
  'Liên kết này có từ trước khi hệ thống lưu sản phẩm gốc nên không tự trả biến thể về được. Liên hệ kỹ thuật để xử lý tay.';

export interface LinkOptions {
  adminId: string;
  /** Admin đã xem và xác nhận chuyển sản phẩm đang bán sang gian hàng. */
  confirmTakeover?: boolean;
}

/**
 * Duyệt sản phẩm "Tubu giao hộ": chuyển CHÍNH dòng biến thể Pancake sang sản phẩm của đối tác (giữ chỗ tồn, hoàn kho, đồng bộ
 * tồn Pancake vẫn theo `pancakeId` như cũ), xoá biến thể tạm, ghi lịch sử liên kết; sản phẩm gốc hết biến thể thì tắt. Biến thể
 * đang ở sản phẩm đang bán chỉ chuyển khi admin xác nhận. Phải chạy trong transaction cùng lần lật trạng thái duyệt: cập nhật
 * có điều kiện `productId = sản phẩm cũ` nên hai lần duyệt cùng mã chỉ một lần thắng, lần kia ném ConflictException.
 */
export async function linkTubuFulfilledVariation(
  tx: Prisma.TransactionClient,
  product: { id: string; storefrontId: string | null; pancakeLinkCode: string | null },
  opts: LinkOptions,
): Promise<void> {
  if (!product.pancakeLinkCode || !product.storefrontId) return;
  const target = await findLinkablePancakeVariation(tx, product.pancakeLinkCode, product.id);
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
  if (target.requiresAdminConfirm && !opts.confirmTakeover) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: PANCAKE_TAKEOVER_UNCONFIRMED,
      message: `Mã ${target.pancakeId} đang thuộc sản phẩm đang bán "${target.productName}". Xem sản phẩm sẽ bị chuyển rồi tích xác nhận trước khi duyệt.`,
    });
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
  const [left, origin] = await Promise.all([
    tx.variation.count({ where: { productId: target.productId } }),
    tx.product.findUniqueOrThrow({ where: { id: target.productId }, select: { isActive: true } }),
  ]);
  const deactivate = left === 0 && origin.isActive;
  if (deactivate) await tx.product.update({ where: { id: target.productId }, data: { isActive: false } });
  await tx.merchantPancakeLink.create({
    data: {
      productId: product.id,
      storefrontId: product.storefrontId,
      variationId: target.variationId,
      originProductId: target.productId,
      originDeactivated: deactivate,
      takeover: target.requiresAdminConfirm,
      linkedBy: opts.adminId,
    },
  });
}

export interface UnlinkOptions {
  actorId: string;
  reason: string;
  /** Tắt bán sản phẩm đối tác sau khi gỡ (gỡ liên kết của admin, đối tác ngừng bán). Từ chối duyệt giữ nguyên. */
  deactivate: boolean;
  /**
   * Liên kết cũ không rõ sản phẩm gốc: admin gỡ tay thì báo lỗi (`throw`); từ chối/ngừng bán thì bỏ qua (`skip`) để không chặn
   * thao tác chính.
   */
  legacy?: 'throw' | 'skip';
}

/**
 * Gỡ liên kết "Tubu giao hộ" đang mở của sản phẩm đối tác: trả biến thể Pancake về sản phẩm gốc (bật lại nếu chính lần liên kết
 * đã tắt nó), sản phẩm đối tác nhận lại một biến thể tạm không mã Pancake và về chế độ chờ liên kết. Đóng dòng lịch sử có điều
 * kiện `unlinkedAt IS NULL` nên hai lần gỡ chồng nhau chỉ một lần làm. Trả về liên kết vừa gỡ (null: không có gì để gỡ).
 */
export async function unlinkTubuFulfilledVariation(
  tx: Prisma.TransactionClient,
  productId: string,
  opts: UnlinkOptions,
): Promise<{ id: string; variationId: string; originProductId: string } | null> {
  const link = await tx.merchantPancakeLink.findFirst({
    where: { productId, unlinkedAt: null },
    select: { id: true, variationId: true, originProductId: true, originDeactivated: true },
  });
  if (!link) return null;
  if (!link.originProductId) {
    if (opts.legacy === 'throw') throw new BadRequestException(LEGACY_LINK_MESSAGE);
    return null;
  }
  const closed = await tx.merchantPancakeLink.updateMany({
    where: { id: link.id, unlinkedAt: null },
    data: { unlinkedAt: new Date(), unlinkedBy: opts.actorId, unlinkReason: opts.reason.slice(0, 300) },
  });
  if (closed.count === 0) return null;

  await tx.variation.updateMany({
    where: { id: link.variationId, productId },
    data: { productId: link.originProductId },
  });
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { basePrice: true, salePrice: true },
  });
  await tx.variation.create({
    data: {
      productId,
      pancakeId: null,
      sku: `MCH-${Date.now().toString(36).toUpperCase()}-${productId.slice(-6).toUpperCase()}`,
      name: 'Mặc định',
      attributes: {},
      retailPrice: product.basePrice,
      salePrice: product.salePrice,
      stock: 0,
      isActive: true,
    },
  });
  await tx.product.update({
    where: { id: productId },
    data: { fulfilment: 'MERCHANT', ...(opts.deactivate ? { isActive: false } : {}) },
  });
  if (link.originDeactivated) {
    await tx.product.updateMany({ where: { id: link.originProductId, isActive: false }, data: { isActive: true } });
  }
  return { id: link.id, variationId: link.variationId, originProductId: link.originProductId };
}

export type PancakeLinkState = 'LINKED' | 'AVAILABLE' | 'TAKEOVER' | 'UNAVAILABLE';

export interface PancakeLinkPreview {
  code: string;
  state: PancakeLinkState;
  /** Lý do không liên kết được (state UNAVAILABLE). */
  reason: string | null;
  variation: { name: string; stock: number; retailPrice: number; salePrice: number | null } | null;
  /** Sản phẩm đang giữ biến thể: duyệt thì biến thể (cùng lượt bán, tồn kho đang giữ) chuyển khỏi sản phẩm này. */
  origin: {
    id: string;
    name: string;
    slug: string;
    brand: string;
    brandName: string | null;
    isActive: boolean;
    onSale: boolean;
    sold: number;
    reviewCount: number;
    otherVariations: number;
    storefrontTitle: string | null;
  } | null;
  /** Gian hàng là chủ thương hiệu của sản phẩm gốc. */
  brandMatchesStore: boolean;
}

/** Màn duyệt của admin: biến thể và sản phẩm sẽ bị chuyển khi bấm Duyệt (R2-MERCHANT-1). */
export async function describePancakeLink(
  db: Pick<PrismaClient, 'variation' | 'storefront'> | Prisma.TransactionClient,
  product: { id: string; storefrontId: string | null; pancakeLinkCode: string | null },
): Promise<PancakeLinkPreview | null> {
  const code = product.pancakeLinkCode?.trim();
  if (!code) return null;
  const [v, store] = await Promise.all([
    db.variation.findUnique({
      where: { pancakeId: code },
      select: {
        name: true,
        stock: true,
        retailPrice: true,
        salePrice: true,
        isActive: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            brand: true,
            brandId: true,
            brandRef: { select: { name: true } },
            isActive: true,
            approvalStatus: true,
            soldApp: true,
            soldExternal: true,
            reviewCount: true,
            storefrontId: true,
            storefront: { select: { title: true } },
            _count: { select: { variations: true } },
          },
        },
      },
    }),
    product.storefrontId
      ? db.storefront.findUnique({ where: { id: product.storefrontId }, select: { brandId: true } })
      : null,
  ]);
  if (!v) {
    return { code, state: 'UNAVAILABLE', reason: 'Không có biến thể Pancake nào mang mã này.', variation: null, origin: null, brandMatchesStore: false };
  }
  const p = v.product;
  const linked = p.id === product.id;
  const origin = linked
    ? null
    : {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        brandName: p.brandRef?.name ?? null,
        isActive: p.isActive,
        onSale: onSale(p),
        sold: p.soldApp + p.soldExternal,
        reviewCount: p.reviewCount,
        otherVariations: p._count.variations - 1,
        storefrontTitle: p.storefront?.title ?? null,
      };
  const variation = { name: v.name, stock: v.stock, retailPrice: v.retailPrice, salePrice: v.salePrice };
  const brandMatchesStore = !!store?.brandId && store.brandId === p.brandId;
  if (linked) return { code, state: 'LINKED', reason: null, variation, origin: null, brandMatchesStore };
  let reason: string | null = null;
  if (p.storefrontId && p.storefrontId !== product.storefrontId) reason = `Mã đang thuộc sản phẩm của gian hàng ${p.storefront?.title ?? 'khác'}.`;
  else if (!v.isActive) reason = 'Biến thể đang tắt bán trên Pancake hoặc đã bị gỡ.';
  else if (p.storefrontId === product.storefrontId) reason = 'Mã đang thuộc một sản phẩm khác của chính gian hàng này.';
  if (reason) return { code, state: 'UNAVAILABLE', reason, variation, origin, brandMatchesStore };
  return { code, state: origin?.onSale ? 'TAKEOVER' : 'AVAILABLE', reason: null, variation, origin, brandMatchesStore };
}
