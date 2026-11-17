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
