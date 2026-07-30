import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

export interface ComboLine {
  variationId: string;
  productId: string;
  total: number;
}
export interface ComboResult {
  /** Tổng giảm combo (VND). */
  total: number;
  /** Giảm theo từng dòng giỏ, key = variationId. */
  perLine: Record<string, number>;
}

/**
 * Phân bổ giảm giá combo vào từng dòng giỏ (THUẦN — dễ test, không I/O).
 * - `combos`: mỗi combo gồm `pct` + danh sách `productIds`. Combo CHỈ áp khi MỌI productId của nó có trong giỏ.
 * - Dòng khớp nhiều combo → lấy `pct` cao nhất (deterministic).
 * - Giảm mỗi dòng = floor(total × min(pct,100) / 100). Bỏ combo pct<=0 / productIds rỗng.
 */
export function allocateComboDiscounts(
  combos: { pct: number; productIds: string[] }[],
  lines: ComboLine[],
): ComboResult {
  const cartProductIds = new Set(lines.map((l) => l.productId));
  const pctByProduct = new Map<string, number>();
  for (const combo of combos) {
    if (!combo.pct || combo.pct <= 0 || combo.productIds.length === 0) continue;
    const allPresent = combo.productIds.every((pid) => cartProductIds.has(pid));
    if (!allPresent) continue;
    for (const pid of combo.productIds) {
      pctByProduct.set(pid, Math.max(pctByProduct.get(pid) ?? 0, combo.pct));
    }
  }
  const perLine: Record<string, number> = {};
  let total = 0;
  for (const line of lines) {
    const pct = pctByProduct.get(line.productId) ?? 0;
    if (pct <= 0) continue;
    const d = Math.floor((line.total * Math.min(pct, 100)) / 100);
    if (d > 0) {
      perLine[line.variationId] = d;
      total += d;
    }
  }
  return { total, perLine };
}

/** Tính giảm giá combo cho giỏ theo gian hàng (slug). Combo = collection kind=COMBO + comboDiscountPct. */
@Injectable()
export class ComboService {
  constructor(private readonly prisma: PrismaService) {}

  async computeForStorefront(slug: string | null | undefined, lines: ComboLine[]): Promise<ComboResult> {
    if (!slug || lines.length === 0) return { total: 0, perLine: {} };
    const sf = await this.prisma.storefront.findFirst({
      where: { slug, isPublished: true },
      select: {
        collections: {
          where: { kind: 'COMBO' },
          select: {
            comboDiscountPct: true,
            items: { select: { productId: true, isHidden: true } },
          },
        },
      },
    });
    if (!sf) return { total: 0, perLine: {} };
    const combos = sf.collections
      .map((c) => ({
        pct: c.comboDiscountPct ?? 0,
        // SP ẩn không tính vào điều kiện combo (CTV ẩn tạm → vẫn render được combo phần còn lại).
        productIds: c.items.filter((i) => !i.isHidden).map((i) => i.productId),
      }))
      .filter((c) => c.productIds.length > 0);
    return allocateComboDiscounts(combos, lines);
  }
}
