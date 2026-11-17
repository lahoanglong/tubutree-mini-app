import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ECO_BADGES_KEY, ECO_LIMITS, ECO_PASSPORT_KEY, cardFacts, publicFact, type CardEcoFact, type FactRow, type PublicEcoFact } from './eco-facts.rules';

const FACT_SELECT = { productId: true, kind: true, variationId: true, valueGrams: true, baselineText: true, label: true, co2Grams: true, sourceUrl: true } as const;

/**
 * Đọc sự thật xanh ĐÃ DUYỆT cho thẻ, trang sản phẩm và bảng so sánh. Cờ `eco.product_badges_enabled` tắt thì mọi hàm trả rỗng mà không
 * chạm bảng, nên thẻ và trang sản phẩm ra đúng như trước cờ.
 */
@Injectable()
export class EcoFactsReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async badgesOn(): Promise<boolean> {
    return (await this.config.get<unknown>(ECO_BADGES_KEY, false)) === true;
  }

  async passportOn(): Promise<boolean> {
    return (await this.config.get<unknown>(ECO_PASSPORT_KEY, false)) === true;
  }

  private async approvedRows(productIds: readonly string[]): Promise<(FactRow & { productId: string })[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    return this.prisma.productEcoFact.findMany({ where: { status: 'APPROVED', productId: { in: ids } }, select: FACT_SELECT });
  }

  /** Sự thật lên thẻ theo id sản phẩm; sản phẩm không có sự thật nào không có khoá. Cờ tắt: Map rỗng, không truy vấn. */
  async cardFactsFor(cards: readonly { id: string; repVariationId?: string | null }[]): Promise<Map<string, CardEcoFact[]>> {
    const out = new Map<string, CardEcoFact[]>();
    if (cards.length === 0 || !(await this.badgesOn())) return out;
    const rows = await this.approvedRows(cards.map((c) => c.id));
    if (rows.length === 0) return out;
    const byProduct = groupBy(rows);
    for (const c of cards) {
      const facts = cardFacts(byProduct.get(c.id) ?? [], c.repVariationId);
      if (facts.length > 0) out.set(c.id, facts);
    }
    return out;
  }

  /** Mọi sự thật đã duyệt của một sản phẩm (cả dòng của từng phân loại; app-core lọc theo phân loại đang chọn). Cờ tắt: null. */
  async productFacts(productId: string): Promise<PublicEcoFact[] | null> {
    if (!(await this.badgesOn())) return null;
    const rows = await this.approvedRows([productId]);
    return rows.map(publicFact);
  }

  /** Số sự thật đã duyệt cấp sản phẩm hoặc của phân loại so sánh, theo id sản phẩm (hàng "Điểm cộng xanh" của bảng so sánh). Cờ tắt: null. */
  async factCounts(items: readonly { productId: string; variationId: string | null }[]): Promise<Map<string, number> | null> {
    if (!(await this.badgesOn())) return null;
    const rows = await this.approvedRows(items.map((i) => i.productId));
    const byProduct = groupBy(rows);
    const out = new Map<string, number>();
    for (const i of items) {
      const kinds = new Set((byProduct.get(i.productId) ?? []).filter((r) => r.variationId === null || r.variationId === i.variationId).map((r) => r.kind));
      out.set(i.productId, Math.min(kinds.size, ECO_LIMITS.pdpFacts));
    }
    return out;
  }
}

function groupBy<T extends { productId: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.productId);
    if (list) list.push(r);
    else m.set(r.productId, [r]);
  }
  return m;
}
