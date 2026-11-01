import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { loadPublicVisibility } from './public-visibility';
import { publicStorefrontWhere } from './storefront-visibility';
import { BUNDLE_MAX_PCT_DEFAULT, BUNDLE_MAX_PCT_KEY, loadLiveBundles } from '../bundles/bundle-read';
import { allocateBundleDiscounts, mergeMaxPerLine } from '../bundles/bundle-rules';

export interface ComboLine {
  variationId: string;
  productId: string;
  total: number;
  /** Số lượng của dòng, để bundle chia đơn vị được hưởng; thiếu coi như 1 (chỉ test thuần gọi thiếu). */
  quantity?: number;
}
export interface ComboResult {
  /** Tổng giảm combo (VND). */
  total: number;
  /** Giảm theo từng dòng giỏ, key = variationId. */
  perLine: Record<string, number>;
}

/** Combo phải gồm ít nhất từng này sản phẩm KHÁC NHAU — "combo" 1 sản phẩm chỉ là mã giảm % trá hình (MONEY-5). */
export const MIN_COMBO_PRODUCTS = 2;

/**
 * Phân bổ giảm giá combo vào từng dòng giỏ (THUẦN — dễ test, không I/O).
 * - `combos`: mỗi combo gồm `pct` + danh sách `productIds`. Combo CHỈ áp khi MỌI productId của nó có trong giỏ.
 * - Dòng khớp nhiều combo → lấy `pct` cao nhất (deterministic).
 * - Giảm mỗi dòng = floor(total × min(pct,100) / 100). Bỏ combo pct<=0 / dưới MIN_COMBO_PRODUCTS sản phẩm khác nhau.
 */
export function allocateComboDiscounts(
  combos: { pct: number; productIds: string[] }[],
  lines: ComboLine[],
): ComboResult {
  const cartProductIds = new Set(lines.map((l) => l.productId));
  const pctByProduct = new Map<string, number>();
  for (const combo of combos) {
    if (!combo.pct || combo.pct <= 0 || new Set(combo.productIds).size < MIN_COMBO_PRODUCTS) continue;
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

/**
 * Phần hàng tính mã sau combo (THUẦN): dòng KHÔNG giờ vàng trừ phần giảm combo của từng dòng. Checkout (báo giá, đặt đơn,
 * xem trước mã) và giỏ hàng dùng chung để số giảm của mã ở giỏ đúng số checkout sẽ trừ.
 */
export function goodsAfterComboOf(
  nonFlash: { variationId: string; productId: string; total: number }[],
  combo: ComboResult,
): { goodsAfterCombo: number; couponLines: { productId: string; total: number }[] } {
  const nonFlashSubtotal = nonFlash.reduce((s, l) => s + l.total, 0);
  return {
    goodsAfterCombo: Math.max(0, nonFlashSubtotal - combo.total),
    couponLines: nonFlash.map((l) => ({
      productId: l.productId,
      total: Math.max(0, l.total - (combo.perLine[l.variationId] ?? 0)),
    })),
  };
}

const NO_COMBO: ComboResult = { total: 0, perLine: {} };

/**
 * Giảm giá combo của giỏ: combo của gian hàng đang ghi công (collection kind=COMBO + comboDiscountPct) hợp với bundle toàn sàn
 * (`Bundle`, Tubu tài trợ). Mỗi dòng lấy khoản LỚN NHẤT giữa hai nguồn, không cộng dồn. Giỏ, báo giá, xem trước mã và đặt đơn đều
 * gọi đúng hàm này nên số luôn khớp, và kết quả đi thẳng vào `comboPerLine`/`Order.comboDiscount` (hoa hồng, hoàn tiền đọc `paidTotal`).
 * Tên giữ `computeForStorefront` vì nhiều spec đang dựng giả theo tên này; `slug` rỗng vẫn tính bundle.
 */
@Injectable()
export class ComboService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * `buyerId`: chủ gian hàng mua qua chính gian hàng của mình thì không có giảm combo gian hàng — combo là ưu đãi
   * gian hàng dành cho khách, không phải cách CTV tự giảm giá cho bản thân (MONEY-5). Bundle toàn sàn không có ngoại lệ này.
   * `lines` là các dòng KHÔNG giờ vàng (dòng giờ vàng không nhận combo, cũng không tính vào điều kiện đủ bộ).
   */
  async computeForStorefront(slug: string | null | undefined, lines: ComboLine[], buyerId?: string, now: Date = new Date()): Promise<ComboResult> {
    if (lines.length === 0) return NO_COMBO;
    const store = await this.storefrontCombo(slug, lines, buyerId);
    const bundles = await loadLiveBundles(this.prisma, now, [...new Set(lines.map((l) => l.productId))]);
    if (bundles.length === 0) return store;
    const configured = await this.config.get<number>(BUNDLE_MAX_PCT_KEY, BUNDLE_MAX_PCT_DEFAULT);
    const maxPct = typeof configured === 'number' && Number.isFinite(configured) ? configured : BUNDLE_MAX_PCT_DEFAULT;
    const bundle = allocateBundleDiscounts(
      bundles,
      lines.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total, quantity: l.quantity ?? 1 })),
      maxPct,
    );
    return mergeMaxPerLine(store, bundle);
  }

  private async storefrontCombo(slug: string | null | undefined, lines: ComboLine[], buyerId?: string): Promise<ComboResult> {
    if (!slug) return NO_COMBO;
    const sf = await this.prisma.storefront.findFirst({
      where: { slug, ...publicStorefrontWhere(await loadPublicVisibility(this.config)) },
      select: {
        ownerUserId: true,
        collections: {
          where: { kind: 'COMBO' },
          select: {
            comboDiscountPct: true,
            items: { select: { productId: true, isHidden: true, product: { select: { storefrontId: true } } } },
          },
        },
      },
    });
    if (!sf) return NO_COMBO;
    if (buyerId && sf.ownerUserId === buyerId) return NO_COMBO;
    // Clamp LẦN 2 tại nơi đọc — phòng dữ liệu ghi từ trước khi StorefrontService có trần
    // (hoặc ghi thẳng DB) vẫn không cho phép combo vượt trần hiện hành (P0,
    // docs/2026-09-08-review-progress.md). StorefrontService.clampComboPct là lớp chính (chặn
    // lúc ghi); đây là lớp phòng thủ thứ 2 (chặn lúc tính tiền — nơi tiền thật mất đi).
    const maxPct = await this.config.get<number>('storefront.max_combo_pct', 30);
    const combos = sf.collections
      .map((c) => ({
        pct: Math.min(c.comboDiscountPct ?? 0, maxPct),
        // SP ẩn không tính vào điều kiện combo (CTV ẩn tạm → vẫn render được combo phần còn lại). Hàng của gian hàng đối tác
        // cũng vậy: chỉ bán giá lẻ, không được giảm combo (partner-goods.ts).
        productIds: c.items.filter((i) => !i.isHidden && !isPartnerOwnedProduct(i.product)).map((i) => i.productId),
      }))
      .filter((c) => c.productIds.length > 0);
    return allocateComboDiscounts(combos, lines);
  }
}
