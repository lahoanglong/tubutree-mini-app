import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { maskFullName } from '../../common/mask-name';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import {
  normalizeSubdomain,
  normalizeCustomDomain,
  assertIdentifierAvailable,
  recordReleasedIdentifiers,
} from '../storefront/identifier-validation';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { notifyAdmins } from '../../common/notify-admins';
import {
  findLinkablePancakeVariation,
  toMerchantPancakeCheck,
  unlinkTubuFulfilledVariation,
  type LinkablePancakeVariation,
  type MerchantPancakeCheck,
} from './merchant-pancake-link';
import { DEFAULT_IDENTIFIER_COOLDOWN_DAYS } from './merchant-config';

/** Số lần thử lại tối đa khi tạo gian hàng đụng race condition (P2002) trên subdomain. */
const MAX_CREATE_STORE_RETRY = 5;

const STORE_INCLUDE = {
  collections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  },
} satisfies Prisma.StorefrontInclude;

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Cùng công thức che SĐT với `maskPhone` ở loyalty.service.ts (giữ 3 số đầu + 3 số cuối) — không
 * import trực tiếp từ đó (module khác, tránh đụng file agent khác có thể đang sửa song song), chỉ
 * lặp lại ĐÚNG công thức để nhất quán quy ước che dữ liệu toàn hệ thống.
 */
function maskPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

type MaskableShippingAddress = {
  recipient?: unknown;
  phone?: unknown;
  street?: unknown;
  ward?: unknown;
  district?: unknown;
  province?: unknown;
};

/**
 * A5-04 = A6-36 (docs/audit-2026-09): CTV/đại lý không thực sự giao hàng — MỌI đơn (kể cả đơn "SP
 * đối tác"/gian hàng MERCHANT) vẫn bị đẩy Pancake về kho Tubu xử lý vô điều kiện (xem A5-34,
 * checkout.service.ts không rẽ nhánh theo storefront/product nguồn gốc) — nên không có nhu cầu
 * chính đáng với SĐT/tên đầy đủ hay địa chỉ tới cấp số nhà/người nhận. Chỉ giữ khu vực
 * (phường/quận/tỉnh) để biết phạm vi giao, đủ cho CTV tư vấn khách mà không lộ định danh.
 */
function maskShippingAddress(
  raw: unknown,
): { ward: string | null; district: string | null; province: string | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const addr = raw as MaskableShippingAddress;
  return {
    ward: typeof addr.ward === 'string' ? addr.ward : null,
    district: typeof addr.district === 'string' ? addr.district : null,
    province: typeof addr.province === 'string' ? addr.province : null,
  };
}

// Whitelist field đơn trả cho cổng /merchant (CTV/đại lý/admin). Dùng select thay vì include để cột
// mới thêm vào Order không tự rò ra: invoiceRequest (MST/email), note nội bộ, userId, referrerUserId,
// endCustomerKey (SĐT người nhận đơn lên-hộ của CTV khác) KHÔNG nằm ở đây có chủ đích.
const MERCHANT_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  subtotal: true,
  discount: true,
  shippingFee: true,
  total: true,
  paymentMethod: true,
  paymentStatus: true,
  shippingAddress: true,
  shippingPartner: true,
  shippingCode: true,
  shippingStatus: true,
  trackingLink: true,
  createdAt: true,
  updatedAt: true,
  fulfiller: true,
  fulfillerStorefrontId: true,
  items: {
    select: {
      id: true,
      variationId: true,
      productName: true,
      productSlug: true,
      variationName: true,
      unitPrice: true,
      quantity: true,
      total: true,
      backorderedQty: true,
    },
  },
  user: { select: { fullName: true, phone: true } },
} satisfies Prisma.OrderSelect;

export interface UpdateStoreDto {
  title?: string;
  headerNote?: string;
  subdomain?: string;
  customDomain?: string;
  themeColor?: string;
  bankName?: string;
  bankBin?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  warehouseAddress?: string;
  warehouseCity?: string;
  warehouseDistrict?: string;
  warehouseWard?: string;
  warehousePhone?: string;
  avatarUrl?: string;
  coverUrl?: string;
  isPublished?: boolean;
  shippingFee?: number | null;
  freeShipFrom?: number | null;
}

export interface CreateMerchantProductDto {
  name: string;
  description: string;
  shortDesc?: string;
  basePrice: number;
  salePrice?: number;
  images?: string[];
  thumbnail?: string;
  categoryIds?: string[];
  tags?: string[];
  forSegment?: string[];
  ingredients?: unknown;
  certifications?: string[];
  stock?: number;
  /** Mã biến thể Pancake xin "Tubu giao hộ" (D4); chỉ dùng khi `tubuFulfils`. */
  pancakeCode?: string;
  tubuFulfils?: boolean;
}

export interface UpdateMerchantProductDto {
  name?: string;
  description?: string;
  shortDesc?: string;
  basePrice?: number;
  salePrice?: number | null;
  images?: string[];
  thumbnail?: string;
  stock?: number;
  isActive?: boolean;
}

function linkModeLabel(link: LinkablePancakeVariation | null): string {
  if (!link) return 'Đối tác tự giao';
  return link.requiresAdminConfirm ? 'Tubu giao hộ — xin chuyển sản phẩm đang bán, cần admin xác nhận' : 'Tubu giao hộ';
}

/**
 * Phạm vi đơn gian hàng được xem ở "Đơn qua gian hàng": biến thể do chính gian hàng tạo (hàng tự giao) và biến thể Pancake
 * trong khoảng thời gian đang liên kết. Một dòng hàng thuộc gian hàng khi khớp một trong hai.
 */
interface MerchantOrderScope {
  storeId: string;
  storeType: string;
  ownVariationIds: string[];
  links: { variationId: string; linkedAt: Date; unlinkedAt: Date | null }[];
}

function ownsLine(scope: MerchantOrderScope, line: { variationId: string }, orderCreatedAt: Date): boolean {
  if (scope.ownVariationIds.includes(line.variationId)) return true;
  return scope.links.some(
    (l) =>
      l.variationId === line.variationId &&
      orderCreatedAt >= l.linkedAt &&
      (l.unlinkedAt === null || orderCreatedAt < l.unlinkedAt),
  );
}

export const CTV_CANNOT_CREATE_PRODUCT =
  'Gian hàng CTV bán lại sản phẩm Tubu Tree, không đăng sản phẩm riêng. Muốn bán hàng của bạn, hãy đăng ký làm đại lý/đối tác.';

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /**
   * Chỉ gian hàng đối tác (đại lý đã duyệt) đăng sản phẩm riêng: hàng tự giao chỉ có người xử lý đơn ở gian hàng MERCHANT. CTV
   * đăng ký một chạm, không duyệt, nên chỉ bán lại hàng Tubu (SELLER-1); gian hàng của admin cũng là loại CTV.
   */
  private async assertCanSellOwnProducts(userId: string) {
    const store = await this.getOrCreateStore(userId);
    if (store.type !== 'MERCHANT') throw new ForbiddenException(CTV_CANNOT_CREATE_PRODUCT);
    return store;
  }

  /** Kiểm mã biến thể Pancake cho "Tubu giao hộ" (form đăng sản phẩm, nút "Kiểm tra"). */
  async checkPancakeVariation(userId: string, code: string): Promise<MerchantPancakeCheck> {
    await this.assertCanSellOwnProducts(userId);
    const found = await findLinkablePancakeVariation(this.prisma, code);
    if (!found) {
      throw new NotFoundException(
        'Không tìm thấy mã biến thể này trong danh mục Pancake của Tubu Tree, hoặc mã đã được gian hàng khác liên kết. Kiểm tra lại mã với kho Tubu.',
      );
    }
    return toMerchantPancakeCheck(found);
  }

  /**
   * Vai trò thật của caller — dùng để gác các quyết định "ai được tin" (P0 A5-03/A5-04/A5-05,
   * docs/audit-2026-09): tách riêng khỏi getOrCreateStore() vì hàm đó phục vụ CẢ luồng auto-tạo
   * gian hàng (không nên đổi contract trả về của nó chỉ để lấy thêm role).
   */
  private async getCallerRole(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    return user.role;
  }

  async getOrCreateStore(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'AFFILIATE' && user.role !== 'DEALER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ tài khoản đối tác hoặc đại lý mới có quyền mở gian hàng.');
    }

    const store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId },
      include: STORE_INCLUDE,
    });
    if (store) return store;

    const baseSlug = user.referralCode ? user.referralCode.toLowerCase() : `shop-${userId.slice(-6)}`;
    let subdomain = baseSlug;
    let counter = 1;
    while (await this.prisma.storefront.findUnique({ where: { subdomain } })) {
      subdomain = `${baseSlug}-${counter++}`;
    }

    // Bug 1 (race condition): findFirst rồi create phía trên KHÔNG transaction/lock — 2 request
    // đồng thời (double-tap "Mở gian hàng") có thể cùng đọc "chưa có store" rồi cùng create.
    // Từ khi có @@unique([ownerUserId]) (schema.prisma), request thua sẽ ăn P2002. Bug 2 (TOCTOU):
    // vòng lặp kiểm subdomain ở trên (findUnique rồi dùng ngay bên dưới) cũng có thể bị request
    // khác chiếm mất subdomain giữa lúc kiểm và lúc tạo, ăn P2002 trên cột subdomain.
    // Xử lý chung: bắt P2002, ưu tiên kiểm user đã có store chưa (dù P2002 rơi vào cột nào —
    // 2 request của CÙNG 1 user race nhau sẽ trùng CẢ 3 cột slug/subdomain/ownerUserId vì cùng
    // suy ra từ 1 baseSlug) — nếu có, đọc lại và trả về store request thắng vừa tạo thay vì throw.
    // Nếu không phải chính user này (bug 2: đụng subdomain của gian hàng KHÁC), đổi subdomain rồi
    // thử tạo lại thay vì để lỗi 409 chung chung.
    for (let attempt = 0; attempt <= MAX_CREATE_STORE_RETRY; attempt++) {
      try {
        return await this.prisma.storefront.create({
          data: {
            type: user.role === 'DEALER' ? 'MERCHANT' : 'CTV',
            slug: baseSlug,
            subdomain,
            ownerUserId: userId,
            title: `Gian hàng của ${user.fullName ?? 'Đối tác'}`,
            themeColor: '#16a34a',
            isPublished: true,
            publishedAt: new Date(),
            collections: {
              create: {
                title: 'Sản phẩm nổi bật',
                sortOrder: 0,
              },
            },
          },
          include: STORE_INCLUDE,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await this.prisma.storefront.findFirst({
            where: { ownerUserId: userId },
            include: STORE_INCLUDE,
          });
          if (existing) return existing;

          const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]) : [];
          if (target.includes('subdomain') && attempt < MAX_CREATE_STORE_RETRY) {
            subdomain = `${baseSlug}-${counter++}`;
            continue;
          }
        }
        throw err;
      }
    }

    // Không thể tới đây trong thực tế (vòng for luôn return hoặc throw) — chỉ để TypeScript
    // thấy hàm luôn có giá trị trả về.
    throw new BadRequestException('Không thể tạo gian hàng, vui lòng thử lại.');
  }

  async updateStore(userId: string, dto: UpdateStoreDto) {
    const store = await this.getOrCreateStore(userId);
    const cooldownDays =
      (await this.config?.get<number>('storefront.identifier_cooldown_days', DEFAULT_IDENTIFIER_COOLDOWN_DAYS)) ??
      DEFAULT_IDENTIFIER_COOLDOWN_DAYS;
    if ((dto.shippingFee !== undefined || dto.freeShipFrom !== undefined) && store.type !== 'MERCHANT') {
      throw new BadRequestException('Phí giao hàng chỉ áp dụng cho gian hàng đối tác tự giao hàng.');
    }

    // Kho gửi hàng/SĐT liên hệ chỉ có nghĩa với gian hàng tự giao; gian hàng CTV không lưu (SELLER-8).
    const selfShips = store.type === 'MERCHANT';
    const updateData: Prisma.StorefrontUpdateInput = {
      title: dto.title,
      headerNote: dto.headerNote,
      themeColor: dto.themeColor,
      bankName: dto.bankName,
      bankBin: dto.bankBin,
      bankAccountNo: dto.bankAccountNo,
      bankAccountName: dto.bankAccountName,
      ...(selfShips
        ? {
            warehouseAddress: dto.warehouseAddress,
            warehouseCity: dto.warehouseCity,
            warehouseDistrict: dto.warehouseDistrict,
            warehouseWard: dto.warehouseWard,
            warehousePhone: dto.warehousePhone,
          }
        : {}),
      avatarUrl: dto.avatarUrl,
      coverUrl: dto.coverUrl,
      ...(dto.shippingFee !== undefined ? { shippingFee: dto.shippingFee } : {}),
      ...(dto.freeShipFrom !== undefined ? { freeShipFrom: dto.freeShipFrom } : {}),
    };
    // Chuỗi rỗng = xoá (ví dụ gỡ tài khoản nhận đối soát), không lưu ''. Tên gian hàng là cột bắt buộc: không xoá được.
    for (const [key, v] of Object.entries(updateData)) {
      if (key !== 'title' && typeof v === 'string' && v.trim() === '') (updateData as Record<string, unknown>)[key] = null;
    }

    if (dto.isPublished !== undefined) {
      updateData.isPublished = dto.isPublished;
      updateData.publishedAt = dto.isPublished ? new Date() : null;
    }

    if (dto.subdomain !== undefined) {
      const cleanSub = normalizeSubdomain(dto.subdomain);
      // Kiểm trùng CHÉO cả slug/subdomain/customDomain — trước đây chỉ kiểm trùng subdomain-
      // với-subdomain, cho phép CTV chiếm subdomain trùng SLUG của gian hàng khác (P0-1,
      // docs/2026-09-08-review-progress.md), từ đó lộ/giả mạo gian hàng qua các truy vấn OR
      // ở tầng đọc (vd bank-transfer.service.ts tra QR ngân hàng theo storefrontSlug).
      await assertIdentifierAvailable(this.prisma, cleanSub, store.id, cooldownDays);
      updateData.subdomain = cleanSub;
    }

    if (dto.customDomain !== undefined) {
      if (dto.customDomain.trim() === '') {
        updateData.customDomain = null; // xoá tên miền riêng
      } else {
        // Trước đây KHÔNG có validate/kiểm trùng nào cho customDomain — ghi thẳng chuỗi bất kỳ,
        // kể cả trùng subdomain/slug của gian hàng khác (P0-1).
        const cleanDomain = normalizeCustomDomain(dto.customDomain);
        await assertIdentifierAvailable(this.prisma, cleanDomain, store.id, cooldownDays);
        updateData.customDomain = cleanDomain;
      }
    }

    await recordReleasedIdentifiers(
      this.prisma,
      store.id,
      [store.subdomain, store.customDomain],
      [
        updateData.subdomain === undefined ? store.subdomain : (updateData.subdomain as string | null),
        updateData.customDomain === undefined ? store.customDomain : (updateData.customDomain as string | null),
      ],
    );

    const newTitle = typeof updateData.title === 'string' ? updateData.title : null;
    if (!newTitle || newTitle === store.title) {
      return this.prisma.storefront.update({ where: { id: store.id }, data: updateData });
    }
    // Tên nhãn của sản phẩm tự đăng chép từ tên gian hàng lúc đăng: đổi tên gian hàng thì đổi theo (R2-MERCHANT-7).
    const [updated] = await this.prisma.$transaction([
      this.prisma.storefront.update({ where: { id: store.id }, data: updateData }),
      this.prisma.product.updateMany({ where: { storefrontId: store.id, brand: store.title }, data: { brand: newTitle } }),
    ]);
    return updated;
  }

  async publishStore(userId: string, isPublished: boolean) {
    const store = await this.getOrCreateStore(userId);
    return this.prisma.storefront.update({
      where: { id: store.id },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
  }

  /**
   * "Tạm nghỉ" (R2-MERCHANT-13): hàng tự giao của gian hàng không đặt được tới khi đối tác tắt; hàng "Tubu giao hộ" vẫn bán vì
   * kho Tubu giao. Khác "Xuất bản gian hàng" (chỉ ẩn trang gian hàng).
   */
  async setOrdersPaused(userId: string, paused: boolean) {
    const store = await this.assertCanSellOwnProducts(userId);
    return this.prisma.storefront.update({
      where: { id: store.id },
      data: { ordersPausedAt: paused ? (store.ordersPausedAt ?? new Date()) : null },
    });
  }

  async createProduct(userId: string, dto: CreateMerchantProductDto) {
    const store = await this.assertCanSellOwnProducts(userId);
    if (dto.salePrice != null && dto.salePrice > dto.basePrice) {
      throw new BadRequestException('Giá khuyến mãi không được cao hơn giá gốc.');
    }
    // "Tubu giao hộ": giá và tồn theo biến thể Pancake; admin duyệt mới chuyển biến thể đó sang sản phẩm này.
    let link: LinkablePancakeVariation | null = null;
    if (dto.tubuFulfils) {
      if (!dto.pancakeCode?.trim()) throw new BadRequestException('Nhập mã biến thể Pancake để chọn "Tubu giao hộ".');
      link = await findLinkablePancakeVariation(this.prisma, dto.pancakeCode);
      if (!link) {
        throw new BadRequestException(
          'Mã biến thể Pancake không có trong danh mục của Tubu Tree hoặc đã được gian hàng khác liên kết. Bỏ chọn "Tubu giao hộ" để tự giao hàng.',
        );
      }
    }

    const baseSlug = slugify(dto.name);
    const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;
    const sku = `MCH-${Date.now().toString(36).toUpperCase()}`;
    const retailPrice = link ? link.retailPrice : dto.basePrice;
    const salePrice = link ? link.salePrice : (dto.salePrice ?? null);

    // PENDING_REVIEW: chưa bán được cho tới khi admin duyệt. Sản phẩm đối tác không mang mã Pancake nào (D4): hàng tự giao đi
    // hàng chờ của đối tác; hàng "Tubu giao hộ" nhận biến thể Pancake thật lúc duyệt.
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        slug: uniqueSlug,
        pancakeId: null,
        fulfilment: 'MERCHANT',
        pancakeLinkCode: link?.pancakeId ?? null,
        brand: store.title,
        description: dto.description,
        shortDesc: dto.shortDesc,
        basePrice: retailPrice,
        salePrice,
        images: dto.images ?? [],
        thumbnail: dto.thumbnail ?? dto.images?.[0] ?? null,
        categoryIds: dto.categoryIds ?? [],
        tags: dto.tags ?? [],
        forSegment: dto.forSegment ?? [],
        ingredients: (dto.ingredients as Prisma.InputJsonValue) ?? undefined,
        certifications: dto.certifications ?? [],
        storefrontId: store.id,
        approvalStatus: 'PENDING_REVIEW',
        isActive: true,
        variations: {
          create: {
            pancakeId: null,
            sku,
            name: 'Mặc định',
            attributes: {},
            retailPrice,
            salePrice,
            stock: link ? 0 : (dto.stock ?? 0),
            isActive: true,
          },
        },
      },
      include: {
        variations: true,
      },
    });

    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      {
        template: 'OPS_MERCHANT_PRODUCT_PENDING',
        subject: `sản phẩm đối tác ${product.id} chờ duyệt`,
        data: () => ({ store: store.title, product_name: product.name, mode: linkModeLabel(link) }),
      },
    ).catch((e) => this.logger.warn(`Báo admin sản phẩm đối tác ${product.id} lỗi: ${(e as Error).message}`));

    // Tự động gắn vào bộ sưu tập đầu tiên của gian hàng
    const defaultCollection = store.collections[0];
    if (defaultCollection) {
      const count = await this.prisma.storefrontItem.count({ where: { collectionId: defaultCollection.id } });
      await this.prisma.storefrontItem.create({
        data: {
          collectionId: defaultCollection.id,
          productId: product.id,
          sortOrder: count,
        },
      });
    }

    return product;
  }

  /**
   * Sửa sản phẩm tự đăng. Giá, tồn kho, ngừng/mở bán có hiệu lực ngay; đổi tên, mô tả, ảnh của sản phẩm đã duyệt (hoặc bị từ
   * chối) thì về chờ duyệt lại: nội dung khách thấy luôn qua kiểm duyệt. Sản phẩm "Tubu giao hộ" lấy giá và tồn theo Pancake.
   */
  async updateProduct(userId: string, productId: string, dto: UpdateMerchantProductDto) {
    const store = await this.assertCanSellOwnProducts(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storefrontId: store.id },
      include: { variations: { orderBy: { id: 'asc' } } },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm của gian hàng bạn.');
    const tubuFulfilled = product.fulfilment === 'TUBU';
    // Sản phẩm xin "Tubu giao hộ" chưa (hoặc không còn) liên kết: chờ admin duyệt để nhận biến thể Pancake.
    const awaitingLink = !tubuFulfilled && !!product.pancakeLinkCode;
    if ((tubuFulfilled || awaitingLink) && (dto.basePrice !== undefined || dto.salePrice !== undefined || dto.stock !== undefined)) {
      throw new BadRequestException('Sản phẩm Tubu giao hộ lấy giá và tồn kho theo kho Tubu (Pancake), không sửa tại đây.');
    }
    const basePrice = dto.basePrice ?? product.basePrice;
    const salePrice = dto.salePrice === undefined ? product.salePrice : dto.salePrice;
    if (salePrice != null && salePrice > basePrice) {
      throw new BadRequestException('Giá khuyến mãi không được cao hơn giá gốc.');
    }
    const contentChanged =
      (dto.name !== undefined && dto.name !== product.name) ||
      (dto.description !== undefined && dto.description !== product.description) ||
      (dto.shortDesc !== undefined && dto.shortDesc !== product.shortDesc) ||
      (dto.images !== undefined && JSON.stringify(dto.images) !== JSON.stringify(product.images)) ||
      (dto.thumbnail !== undefined && dto.thumbnail !== product.thumbnail);
    // Mở bán lại sản phẩm đã gỡ liên kết thì admin duyệt lại để liên kết lại biến thể Pancake.
    const relink = awaitingLink && dto.isActive === true && product.approvalStatus === 'APPROVED';
    const reReview = (contentChanged || relink) && product.approvalStatus !== 'PENDING_REVIEW';

    await this.prisma.$transaction(async (tx) => {
      // Ngừng bán sản phẩm đã liên kết: trả biến thể Pancake về sản phẩm gốc (R2-MERCHANT-1).
      if (tubuFulfilled && dto.isActive === false) {
        await unlinkTubuFulfilledVariation(tx, product.id, {
          actorId: userId,
          reason: 'Đối tác ngừng bán',
          deactivate: true,
        });
      }
      await tx.product.update({
        where: { id: product.id },
        data: {
          name: dto.name,
          description: dto.description,
          shortDesc: dto.shortDesc,
          images: dto.images,
          thumbnail: dto.thumbnail,
          isActive: dto.isActive,
          ...(tubuFulfilled ? {} : { basePrice, salePrice }),
          ...(reReview ? { approvalStatus: 'PENDING_REVIEW' as const, rejectReason: null } : {}),
        },
      });
      const first = product.variations[0];
      if (!tubuFulfilled && first) {
        await tx.variation.update({
          where: { id: first.id },
          data: {
            retailPrice: basePrice,
            salePrice,
            ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
      }
    });
    if (reReview) {
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        {
          template: 'OPS_MERCHANT_PRODUCT_PENDING',
          subject: `sản phẩm đối tác ${product.id} sửa nội dung`,
          data: () => ({
            store: store.title,
            product_name: dto.name ?? product.name,
            mode: tubuFulfilled || awaitingLink ? 'Tubu giao hộ' : 'Đối tác tự giao',
          }),
        },
      ).catch((e) => this.logger.warn(`Báo admin sản phẩm đối tác ${product.id} lỗi: ${(e as Error).message}`));
    }
    return this.prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variations: true } });
  }

  /** Ngừng bán (không xoá: đơn cũ, đánh giá, đối soát vẫn trỏ tới sản phẩm). */
  async stopSellingProduct(userId: string, productId: string) {
    return this.updateProduct(userId, productId, { isActive: false });
  }

  // Bug 3: trước đây không có take/skip — merchant đăng quá `limit` mặc định của DB không bao
  // giờ xem hết được sản phẩm của chính mình (và danh sách bán lại). Nay phân trang thật, dùng
  // chung page/limit cho cả 2 danh sách (own + resell) vì cả 2 đến từ 1 request/1 màn hình.
  async listMyProducts(userId: string, page = 1, limit = 20) {
    const [store, role] = await Promise.all([this.getOrCreateStore(userId), this.getCallerRole(userId)]);
    const { skip, take } = skipTake(page, limit);

    const ownWhere: Prisma.ProductWhereInput = { storefrontId: store.id };
    const resellWhere: Prisma.StorefrontItemWhereInput = {
      collection: { storefrontId: store.id },
      product: { storefrontId: { not: store.id } },
    };

    // 1. Sản phẩm do merchant tự đăng
    // 2. Sản phẩm Tubu Tree chọn bán lại (thông qua StorefrontItem)
    const [ownTotal, ownProducts, resellTotal, resellItems] = await Promise.all([
      this.prisma.product.count({ where: ownWhere }),
      this.prisma.product.findMany({
        where: ownWhere,
        orderBy: { createdAt: 'desc' },
        include: { variations: true },
        skip,
        take,
      }),
      this.prisma.storefrontItem.count({ where: resellWhere }),
      this.prisma.storefrontItem.findMany({
        where: resellWhere,
        include: {
          product: {
            include: { variations: true },
          },
        },
        skip,
        take,
      }),
    ]);

    const resellProducts = resellItems.map((item) => item.product);
    const held = await this.heldForUnshipped(store.id, ownProducts.flatMap((p) => p.variations.map((v) => v.id)));
    const ownShaped = ownProducts.map((p) => ({
      ...p,
      // Ô "Tồn kho" là số còn bán được: đơn tự giao chưa gửi đã trừ khỏi đó (R2-MERCHANT-9).
      heldQty: p.variations.reduce((sum, v) => sum + (held.get(v.id) ?? 0), 0),
      linkState: p.fulfilment === 'TUBU' && p.pancakeLinkCode ? 'LINKED' : p.pancakeLinkCode ? 'AWAITING' : null,
    }));
    // P0 A5-05 (docs/audit-2026-09): đăng ký CTV (AFFILIATE) chỉ 1 chạm, không duyệt — không được
    // đọc dealerPrices (giá sỉ theo bậc đại lý) hay affiliateRate (%) của BẤT KỲ sản phẩm nào.
    // DEALER (hồ sơ admin duyệt) và ADMIN vẫn cần các trường này (đại lý xem giá sỉ là tính năng
    // có chủ đích ở /dealer) nên chỉ ẩn với đúng role AFFILIATE.
    const shouldHidePricingInternals = role === 'AFFILIATE';

    return {
      ownProducts: shouldHidePricingInternals ? this.stripPricingInternals(ownShaped) : ownShaped,
      resellProducts: shouldHidePricingInternals ? this.stripPricingInternals(resellProducts) : resellProducts,
      meta: { page, limit, ownTotal, resellTotal },
    };
  }

  /** Số đơn vị của đơn gian hàng tự giao đã đặt mà chưa gửi đi, theo biến thể. */
  private async heldForUnshipped(storefrontId: string, variationIds: string[]): Promise<Map<string, number>> {
    if (variationIds.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: ['variationId'],
      where: {
        variationId: { in: variationIds },
        order: {
          fulfiller: 'MERCHANT',
          fulfillerStorefrontId: storefrontId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] },
        },
      },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.variationId, r._sum.quantity ?? 0]));
  }

  /** Bỏ hẳn key dealerPrices/affiliateRate (không chỉ set null) khỏi variations — xem A5-05. */
  private stripPricingInternals<P extends { variations: Array<Record<string, unknown>> }>(products: P[]) {
    return products.map((p) => ({
      ...p,
      variations: p.variations.map(({ dealerPrices: _dealerPrices, affiliateRate: _affiliateRate, ...safe }) => safe),
    }));
  }

  async addResellProduct(userId: string, productId: string, collectionId?: string) {
    const store = await this.getOrCreateStore(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true, approvalStatus: true },
    });
    if (!product || !product.isActive || product.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Sản phẩm không khả dụng để bán lại.');
    }

    const targetColId = collectionId ?? store.collections[0]?.id;
    if (!targetColId) {
      throw new BadRequestException('Gian hàng chưa có bộ sưu tập sản phẩm.');
    }
    // IDOR (P1-1, docs/2026-09-08-review-progress.md): collectionId đến từ body — trước đây
    // KHÔNG kiểm nó thuộc CHÍNH gian hàng của caller. Id collection của gian hàng khác lộ qua
    // trang public (GET /storefront/public/:slug trả collections[].id), đủ để chèn sản phẩm
    // thẳng vào gian hàng người khác. store.collections đã include sẵn ở getOrCreateStore.
    if (collectionId && !store.collections.some((c) => c.id === collectionId)) {
      throw new BadRequestException('Bộ sưu tập không thuộc gian hàng của bạn.');
    }

    const existing = await this.prisma.storefrontItem.findFirst({
      where: { collectionId: targetColId, productId },
    });
    if (existing) return existing;

    const count = await this.prisma.storefrontItem.count({ where: { collectionId: targetColId } });
    return this.prisma.storefrontItem.create({
      data: {
        collectionId: targetColId,
        productId,
        sortOrder: count,
      },
    });
  }

  async removeResellProduct(userId: string, productId: string) {
    const store = await this.getOrCreateStore(userId);
    await this.prisma.storefrontItem.deleteMany({
      where: {
        collection: { storefrontId: store.id },
        productId,
      },
    });
    return { ok: true };
  }

  private async merchantOrderScope(userId: string): Promise<MerchantOrderScope> {
    const store = await this.getOrCreateStore(userId);
    const [variations, links] = await Promise.all([
      this.prisma.variation.findMany({ where: { product: { storefrontId: store.id } }, select: { id: true } }),
      this.prisma.merchantPancakeLink.findMany({
        where: { storefrontId: store.id },
        select: { variationId: true, linkedAt: true, unlinkedAt: true },
      }),
    ]);
    const linked = new Set(links.map((l) => l.variationId));
    return {
      storeId: store.id,
      storeType: store.type,
      ownVariationIds: variations.map((v) => v.id).filter((id) => !linked.has(id)),
      links,
    };
  }

  /**
   * Bug 4: một hàm dùng chung cho listMerchantOrders và updateMerchantOrderStatus (biến kiểm soát truy cập).
   *
   * Gian hàng đối tác (MERCHANT) chỉ thấy đơn có dòng hàng của mình: biến thể tự tạo, hoặc biến thể Pancake "Tubu giao hộ"
   * trong khoảng [linkedAt, unlinkedAt) — đơn của SKU đó trước khi liên kết là đơn của Tubu/nhãn cũ (R2-MERCHANT-5). Gian hàng
   * CTV giữ cách cũ: đơn khách đặt qua gian hàng (khoá ngoại chốt lúc đặt, SELLER-5) để CTV theo dõi hoa hồng.
   *
   * OR rỗng = điều kiện luôn sai trong Prisma, nên gian hàng chưa có gì tự nhiên ra danh sách rỗng.
   */
  private orderWhereOf(scope: MerchantOrderScope): Prisma.OrderWhereInput {
    const or: Prisma.OrderWhereInput[] = [];
    if (scope.storeType !== 'MERCHANT') or.push({ storefrontId: scope.storeId });
    if (scope.ownVariationIds.length > 0) or.push({ items: { some: { variationId: { in: scope.ownVariationIds } } } });
    for (const l of scope.links) {
      or.push({
        createdAt: { gte: l.linkedAt, ...(l.unlinkedAt ? { lt: l.unlinkedAt } : {}) },
        items: { some: { variationId: l.variationId } },
      });
    }
    return { OR: or };
  }

  private async resolveMerchantOrderFilter(userId: string): Promise<Prisma.OrderWhereInput> {
    return this.orderWhereOf(await this.merchantOrderScope(userId));
  }

  // Bug 3: `take: 50` không kèm `skip` — merchant có trên 50 đơn không bao giờ xem được đơn cũ
  // hơn. Nay phân trang thật kèm meta {total, page, limit}.
  async listMerchantOrders(userId: string, status?: string, page = 1, limit = 20) {
    const [scope, role] = await Promise.all([this.merchantOrderScope(userId), this.getCallerRole(userId)]);
    const where: Prisma.OrderWhereInput = {
      ...this.orderWhereOf(scope),
      ...(status ? { status: status as never } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: MERCHANT_ORDER_SELECT,
        ...skipTake(page, limit),
      }),
    ]);

    // Gian hàng đối tác: chỉ dòng hàng của mình, không tổng đơn hay dòng của nhãn khác — trừ đơn chính gian hàng tự giao
    // (cả đơn là hàng của gian hàng). `selfFulfilled` để màn hình chỉ sang tab Đơn cần giao thay vì ghi "Do kho Tubu xử lý".
    const scoped = data.map(({ fulfiller, fulfillerStorefrontId, ...order }) => {
      const selfFulfilled = fulfiller === 'MERCHANT' && fulfillerStorefrontId === scope.storeId;
      if (scope.storeType !== 'MERCHANT' || selfFulfilled) {
        return { ...order, items: order.items.map(({ variationId: _v, ...it }) => it), selfFulfilled, partial: false };
      }
      const own = order.items.filter((it) => ownsLine(scope, it, order.createdAt));
      return {
        ...order,
        subtotal: null,
        discount: null,
        shippingFee: null,
        total: null,
        ownTotal: own.reduce((sum, it) => sum + it.total, 0),
        items: own.map(({ variationId: _v, ...it }) => it),
        selfFulfilled,
        partial: own.length < order.items.length,
      };
    });

    // P0 A5-04 = A6-36 (docs/audit-2026-09): chỉ ADMIN mới thấy tên/SĐT/địa chỉ đầy đủ của khách —
    // xem lý do đầy đủ ở maskShippingAddress(). DEALER/AFFILIATE đều bị che như nhau.
    const shaped =
      role === 'ADMIN'
        ? scoped
        : scoped.map((order) => ({
            ...order,
            user: order.user
              ? { ...order.user, fullName: maskFullName(order.user.fullName), phone: maskPhoneNumber(order.user.phone) }
              : order.user,
            shippingAddress: maskShippingAddress(order.shippingAddress),
          }));

    return paginated(shaped, page, limit, total);
  }

  async updateMerchantOrderStatus(userId: string, orderId: string, status: string) {
    // P0 A5-03 = A6-02 (docs/audit-2026-09/05-ctv-dealer-staff.md, 06-web.md): CTV/đại lý tự bấm
    // chuyển đơn "Đã đóng gói→Đang giao→Đã giao" (cả CANCELLED/RETURNED) cho MỌI đơn gắn gian hàng
    // của mình — kể cả đơn do kho Tubu thật sự xử lý (mọi đơn đều bị đẩy Pancake vô điều kiện, xem
    // A5-34: checkout.service.ts không rẽ nhánh theo storefront/product nguồn gốc), khoá hoa hồng +
    // cộng điểm Xanh dựa trên lời tự khai "đã giao" có thể giả. Không có cờ "tự giao hàng đã xác
    // minh" nào trong schema hiện tại để phân biệt "đối tác thật sự tự đóng gói & giao" khỏi "đơn
    // CTV referral, kho Tubu giao" — mặc định AN TOÀN là chặn hẳn tự chuyển trạng thái qua cổng
    // /merchant cho DEALER lẫn AFFILIATE. ADMIN vẫn được (đã có toàn quyền qua /admin sẵn, không
    // phải bên tự-báo-cáo có lợi ích tài chính trong đơn).
    // TODO(nghiệp vụ, cần thiết kế riêng — KHÔNG tự thêm cờ/migration trong bản vá khẩn cấp này):
    // nếu sau này có nhãn/đại lý THẬT SỰ tự giao hàng, cần một cờ do admin bật rõ ràng (ví dụ trên
    // Storefront hoặc Brand) rồi thay điều kiện dưới đây bằng kiểm tra cờ đó.
    const role = await this.getCallerRole(userId);
    if (role !== 'ADMIN') {
      throw new ForbiddenException(
        'Đơn hàng do kho Tubu Tree xử lý giao nhận; đối tác không thể tự chuyển trạng thái tại đây.',
      );
    }

    const ALLOWED = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException(`Trạng thái "${status}" không hợp lệ.`);
    }

    const filter = await this.resolveMerchantOrderFilter(userId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...filter,
      },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng thuộc quyền quản lý của bạn.');

    // Trước đây ghi status trực tiếp — không guard transition (DELIVERED có thể bị lùi về
    // CONFIRMED rồi khách tự hủy lại, hoàn tiền/restock lần 2 trên đơn đã giao — P0-1) VÀ
    // không cộng/đảo điểm Xanh + hoa hồng CTV (đơn CTV tự đổi DELIVERED/CANCELLED không bao
    // giờ credit/reverse — mất vĩnh viễn, P1-1). Ủy quyền cho OrderStatusService — cùng nguồn
    // ghi status với admin/pancake. Xem docs/2026-09-08-review-progress.md.
    try {
      return await this.orderStatus.setStatus(order.id, status as OrderStatus, {
        actorType: 'MERCHANT',
        actorId: userId,
      });
    } catch (err) {
      toHttpBadRequest(err);
    }
  }
}
