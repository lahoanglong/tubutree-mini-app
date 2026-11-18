import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { publicImage } from '../../common/public-image';
import { SystemConfigService } from '../system-config/system-config.service';
import { SELLABLE_PANCAKE_VARIATION_WHERE } from '../cart/sellable';
import {
  GIFT_CHOICE_NONE,
  giftTrialBase,
  giftTrialCartDemand,
  giftTrialSummary,
  loadGiftTrialSettings,
  type GiftTrialBaseLine,
  type GiftTrialSettings,
  type GiftTrialStock,
} from './gift-trial';

type VariationReader = Pick<Prisma.TransactionClient, 'variation'>;

/** Biến thể quà còn đưa ra được: bán được, kho Tubu Tree giao qua Pancake (quà đi cùng kiện Tubu), còn ít nhất 1. */
export const GIFT_TRIAL_VARIATION_WHERE = { ...SELLABLE_PANCAKE_VARIATION_WHERE, stock: { gte: 1 } } as const satisfies Prisma.VariationWhereInput;

export const GIFT_TRIAL_DISABLED_MESSAGE = 'Quà tặng dùng thử đang tạm dừng.';
export const GIFT_TRIAL_NOT_OFFERED_MESSAGE = 'Quà này không còn trong danh sách quà tặng dùng thử. Bạn chọn quà khác nhé.';
export const GIFT_TRIAL_OUT_MESSAGE = 'Quà này vừa hết. Bạn chọn quà khác nhé.';

@Injectable()
export class GiftTrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  settings(): Promise<GiftTrialSettings> {
    return loadGiftTrialSettings(this.config);
  }

  /**
   * Thông tin hiển thị của các quà còn đưa ra được, theo id biến thể. `cartDemand`: số lượng chính biến thể đó khách đang mua trong giỏ;
   * đặt đơn giữ kho dòng hàng trước rồi mới tới quà, nên quà chỉ còn khi tồn đủ cả phần giỏ lẫn 1 quà (không thì khách bị 409 lặp lại).
   */
  async stockOf(
    variationIds: readonly string[],
    db: VariationReader = this.prisma,
    cartDemand: ReadonlyMap<string, number> = new Map(),
  ): Promise<Map<string, GiftTrialStock>> {
    if (variationIds.length === 0) return new Map();
    const rows = await db.variation.findMany({
      where: { id: { in: [...variationIds] }, ...GIFT_TRIAL_VARIATION_WHERE },
      select: { id: true, name: true, stock: true, productId: true, product: { select: { name: true, slug: true, thumbnail: true } } },
    });
    return new Map(
      rows.filter((v) => v.stock >= 1 + (cartDemand.get(v.id) ?? 0)).map((v) => [
        v.id,
        {
          variationId: v.id,
          productName: v.product.name,
          variationName: v.name,
          slug: v.product.slug,
          thumbnail: publicImage('product', v.productId, 'thumb', v.product.thumbnail),
        },
      ]),
    );
  }

  /**
   * Khối quà của một giỏ (hoặc phần giỏ đang đặt). Cờ tắt: `null` mà không đọc thêm gì. `choice` truyền vào khi người gọi đã đọc giỏ; bỏ trống
   * thì đọc `carts.giftChoice` của khách.
   */
  async summaryFor(
    userId: string,
    lines: ReadonlyArray<GiftTrialBaseLine>,
    opts: { choice?: string | null; settings?: GiftTrialSettings } = {},
  ): Promise<GiftTrialSummaryDTO | null> {
    const settings = opts.settings ?? (await this.settings());
    if (!settings.enabled || settings.options.length === 0) return null;
    const choice =
      opts.choice !== undefined
        ? opts.choice
        : ((await this.prisma.cart.findUnique({ where: { userId }, select: { giftChoice: true } }))?.giftChoice ?? null);
    const stock = await this.stockOf(settings.options.map((o) => o.variationId), this.prisma, giftTrialCartDemand(lines));
    return giftTrialSummary(settings, giftTrialBase(lines), stock, choice);
  }

  /**
   * Ghi lựa chọn quà của khách vào giỏ. `null` = "Không nhận quà". Chỉ nhận quà đang có trong cấu hình và còn hàng; chưa xét mốc ở đây vì
   * giỏ còn đổi: giỏ và báo giá tự rơi về quà đã mở, đặt đơn kiểm lại mốc.
   */
  async setChoice(userId: string, variationId: string | null): Promise<void> {
    const settings = await this.settings();
    if (!settings.enabled) throw new BadRequestException(GIFT_TRIAL_DISABLED_MESSAGE);
    if (variationId !== null) {
      if (!settings.options.some((o) => o.variationId === variationId)) throw new BadRequestException(GIFT_TRIAL_NOT_OFFERED_MESSAGE);
      if (!(await this.stockOf([variationId])).has(variationId)) throw new BadRequestException(GIFT_TRIAL_OUT_MESSAGE);
    }
    const giftChoice = variationId ?? GIFT_CHOICE_NONE;
    await this.prisma.cart.upsert({ where: { userId }, create: { userId, giftChoice }, update: { giftChoice } });
  }
}
