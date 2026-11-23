import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { SELLABLE_VARIATION_WHERE } from '../cart/sellable';

export const RESTOCK_ALERT_ENABLED_KEY = 'catalog.restock_alert_enabled';
/** Số đăng ký "Báo tôi khi có hàng" đang chờ tối đa của một khách. */
export const RESTOCK_MAX_PENDING_PER_USER = 20;

export interface RestockStatus {
  /** Cờ catalog.restock_alert_enabled: tắt thì hai app giữ nút xám "Tạm hết hàng". */
  enabled: boolean;
  /** Biến thể của sản phẩm mà khách đang chờ báo hàng về (rỗng khi chưa đăng nhập hoặc cờ tắt). */
  variationIds: string[];
}

export interface RestockToggleResult {
  variationId: string;
  subscribed: boolean;
}

/** Một đăng ký đang chờ hàng về của khách, kèm đủ thông tin sản phẩm để trang Yêu thích gắn vào thẻ mà không phải hỏi thêm. */
export interface MyRestockAlert {
  variationId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variationName: string;
  /** Tồn bán được của phân loại lúc đọc; > 0 nghĩa là hàng đã về và tin báo đang chờ lượt cron kế tiếp. */
  stock: number;
  createdAt: string;
}

export interface MyRestockAlerts {
  /** Cờ catalog.restock_alert_enabled: tắt thì trang Yêu thích không có chuông, nhãn hay chip "Chờ hàng về". */
  enabled: boolean;
  items: MyRestockAlert[];
}

/** Trần dòng trả về: trần đăng ký đang chờ là 20 nên số này chỉ chặn dữ liệu cũ bất thường, không cắt khách bình thường. */
const MY_RESTOCK_LIST_MAX = RESTOCK_MAX_PENDING_PER_USER * 2;

interface MyRestockAlertRow {
  variationId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variationName: string;
  stock: number;
  createdAt: Date;
}

@Injectable()
export class RestockAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async enabled(): Promise<boolean> {
    return (await this.config.get<unknown>(RESTOCK_ALERT_ENABLED_KEY, false)) === true;
  }

  async status(productId: string, userId?: string): Promise<RestockStatus> {
    const enabled = await this.enabled();
    if (!enabled || !userId) return { enabled, variationIds: [] };
    const rows = await this.prisma.restockAlert.findMany({
      where: { userId, notifiedAt: null, variation: { productId } },
      select: { variationId: true },
      orderBy: { createdAt: 'asc' },
    });
    return { enabled, variationIds: rows.map((r) => r.variationId) };
  }

  /**
   * Mọi đăng ký đang chờ (`notifiedAt` NULL) của chính khách, cũ trước mới sau, cùng sản phẩm và phân loại trong MỘT câu SQL nối ba bảng.
   * Chỉ lọc theo `userId` của phiên, không nhận tham số khách nào khác. Cờ tắt thì trả rỗng như `status`, vì khi đó không có nút nào để
   * khách bấm; khách vẫn huỷ được ở `DELETE` (không phụ thuộc cờ).
   */
  async mine(userId: string): Promise<MyRestockAlerts> {
    const enabled = await this.enabled();
    if (!enabled) return { enabled, items: [] };
    const rows = await this.prisma.$queryRaw<MyRestockAlertRow[]>`
      SELECT ra."variationId", v."productId", p."slug" AS "productSlug", p."name" AS "productName", v."name" AS "variationName",
             v."stock", ra."createdAt"
      FROM "restock_alerts" ra
      JOIN "variations" v ON v."id" = ra."variationId"
      JOIN "products" p ON p."id" = v."productId"
      WHERE ra."userId" = ${userId} AND ra."notifiedAt" IS NULL
      ORDER BY ra."createdAt" ASC, ra."id" ASC
      LIMIT ${MY_RESTOCK_LIST_MAX}`;
    return {
      enabled,
      items: rows.map((r) => ({
        variationId: r.variationId,
        productId: r.productId,
        productSlug: r.productSlug,
        productName: r.productName,
        variationName: r.variationName,
        stock: Number(r.stock),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Đăng ký báo hàng về cho một biến thể đang hết hàng. Gọi lại khi đã đăng ký thì trả như lần đầu (bấm đúp, mạng chập chờn).
   * Khoá advisory theo khách: hai lần bấm song song chỉ ghi một dòng và không vượt trần 20 đăng ký đang chờ; partial unique
   * `restock_alerts_pending_user_variation_key` là chốt chặn thứ hai.
   */
  async subscribe(userId: string, variationId: string): Promise<RestockToggleResult> {
    if (!(await this.enabled())) throw new NotFoundException('Tính năng báo hàng về chưa mở.');
    const variation = await this.prisma.variation.findFirst({ where: { id: variationId, ...SELLABLE_VARIATION_WHERE }, select: { stock: true } });
    if (!variation) throw new NotFoundException('Không tìm thấy sản phẩm này hoặc sản phẩm đã ngừng bán.');
    if (variation.stock > 0) throw new ConflictException('Sản phẩm đang có hàng, bạn đặt mua được ngay.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restock-sub:${userId}`}))`;
        if (await tx.restockAlert.findFirst({ where: { userId, variationId, notifiedAt: null }, select: { id: true } })) return;
        if ((await tx.restockAlert.count({ where: { userId, notifiedAt: null } })) >= RESTOCK_MAX_PENDING_PER_USER) {
          throw new ConflictException(
            `Bạn đang chờ báo hàng về cho ${RESTOCK_MAX_PENDING_PER_USER} sản phẩm, đã đủ số tối đa. Huỷ bớt ở trang sản phẩm rồi đăng ký lại nhé.`,
          );
        }
        await tx.restockAlert.create({ data: { userId, variationId } });
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return { variationId, subscribed: true };
  }

  /** Huỷ đăng ký đang chờ; chưa đăng ký hoặc đã được báo thì không làm gì. Không phụ thuộc cờ để khách luôn rút lại được. */
  async unsubscribe(userId: string, variationId: string): Promise<RestockToggleResult> {
    await this.prisma.restockAlert.deleteMany({ where: { userId, variationId, notifiedAt: null } });
    return { variationId, subscribed: false };
  }
}
