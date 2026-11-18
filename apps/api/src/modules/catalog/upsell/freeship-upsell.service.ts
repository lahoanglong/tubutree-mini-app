import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { CARD_VARIATION_SELECT } from '../card-select';
import { CatalogService } from '../catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../public-product';
import { VARIATION_ORDER_BY, cardPriceWithFlash } from '../variation-order';
import { FREESHIP_BOOSTER_ENABLED_KEY, rankFreeshipUpsell, type FreeshipUpsellRow } from './freeship-upsell';

/** Kho ứng viên (mọi món Tubu giao còn hàng kèm giá thẻ) đọc lại sau chừng này: mỗi lần mở giỏ chỉ lọc trong bộ nhớ, không quét lại catalog. */
export const FREESHIP_UPSELL_POOL_TTL_MS = 30_000;

@Injectable()
export class FreeshipUpsellService {
  private pool: { rows: FreeshipUpsellRow[]; expiresAt: number } | null = null;
  /** Lần nạp đang chạy: nhiều giỏ mở cùng lúc khi kho vừa hết hạn chỉ quét catalog một lần. */
  private loading: Promise<FreeshipUpsellRow[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /**
   * Thẻ gợi ý bù đơn cho khoảng thiếu `gap`, theo thứ tự `rankFreeshipUpsell`, cùng dạng thẻ với `/products` (giá, phân loại đại diện, còn hàng, nơi giao)
   * để hai app vẽ và thêm vào giỏ như mọi thẻ khác. Cờ tắt thì 404: app coi mọi lỗi là "không có dải".
   */
  async addons(gap: number, exclude: ReadonlySet<string>) {
    if (!(await this.enabled())) throw new NotFoundException('Chưa có gợi ý mua thêm lúc này.');
    const ids = rankFreeshipUpsell(await this.candidates(), { gap, exclude });
    return this.catalog.cardsByIds(ids);
  }

  private async enabled(): Promise<boolean> {
    if (!this.config) return false;
    return (await this.config.get<unknown>(FREESHIP_BOOSTER_ENABLED_KEY, false)) === true;
  }

  private async candidates(): Promise<FreeshipUpsellRow[]> {
    const now = Date.now();
    if (this.pool && this.pool.expiresAt > now) return this.pool.rows;
    this.loading ??= this.load()
      .then((rows) => {
        this.pool = { rows, expiresAt: Date.now() + FREESHIP_UPSELL_POOL_TTL_MS };
        return rows;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /**
   * Món bán công khai, kho Tubu giao (hàng gian hàng tự giao không được Miễn phí giao hàng của Tubu nên thêm vào không bù được khoảng thiếu), không phải combo,
   * còn ít nhất một phân loại đang bán có tồn. Giá là giá thẻ gồm Giờ vàng đang thắng (`cardPriceWithFlash`), cùng số hai app hiện trên thẻ.
   */
  private async load(): Promise<FreeshipUpsellRow[]> {
    const [products, offers] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...PUBLIC_PRODUCT_WHERE, fulfilment: 'TUBU', isCombo: false, variations: { some: { isActive: true, stock: { gt: 0 } } } },
        select: {
          id: true,
          slug: true,
          basePrice: true,
          salePrice: true,
          soldApp30d: true,
          soldApp: true,
          soldExternal: true,
          variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: CARD_VARIATION_SELECT },
        },
      }),
      this.catalog.activeFlashOffers(),
    ]);
    return products.map((p) => ({
      id: p.id,
      slug: p.slug,
      price: cardPriceWithFlash(p, p.variations, offers.get(p.id)),
      soldApp30d: p.soldApp30d,
      sold: p.soldApp + p.soldExternal,
    }));
  }
}
