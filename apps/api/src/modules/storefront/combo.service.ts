import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { loadPublicVisibility } from './public-visibility';
import { publicStorefrontWhere } from './storefront-visibility';
import { loadLiveBundles, readBundleMaxPct } from '../bundles/bundle-read';
import {
  allocateBundleDiscountsCappedOwned,
  allocateBundleDiscountsOwned,
  bundleKeyVariationIds,
  isOwnStaffBundle,
  mergeMaxOwned,
  type LiveBundle,
  type OwnedDiscount,
} from '../bundles/bundle-rules';
import { loadStaffCouponCaps } from '../admin/coupon-input-rules';

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

/** Nguồn của nhóm combo: combo gian hàng đang ghi công, bộ "mua đủ bộ giảm %" hoặc bộ "mua kèm" toàn sàn. */
export type ComboGroupKind = 'STOREFRONT' | 'BUNDLE_PCT' | 'ADDON';
/**
 * Một combo đã khớp của giỏ (K5), chia từ chính `perLine` của lần khớp: `Σ discount === total`. Mỗi dòng giảm giá thuộc đúng một nhóm (combo cho khoản lớn nhất;
 * bằng nhau thì combo gian hàng rồi bộ đứng trước).
 */
export interface ComboGroup {
  /** `collection:<id>` hoặc `bundle:<id>`. */
  id: string;
  kind: ComboGroupKind;
  title: string;
  discount: number;
  /** Phân loại mang khoản giảm của nhóm, tăng dần. */
  variationIds: string[];
  /** Phân loại mà bỏ MỘT mình nó thì bộ không còn khớp (có thể gồm dòng không được giảm, như sản phẩm chính của "mua kèm"), tăng dần. */
  keyVariationIds: string[];
}
export interface ComboMatch extends ComboResult {
  groups: ComboGroup[];
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
  const { total, perLine } = allocateComboDiscountsOwned(combos.map((c, i) => ({ id: String(i), ...c })), lines);
  return { total, perLine };
}

/**
 * `allocateComboDiscounts` kèm chủ của từng dòng: combo cho % cao nhất của sản phẩm đó, bằng nhau thì combo đứng trước. Đây là cài đặt DUY NHẤT của luật
 * (hàm không-"Owned" chỉ bỏ `owner`), nên nhóm của giỏ và số tiền thật đến từ cùng một lần khớp.
 */
export function allocateComboDiscountsOwned(combos: { id: string; pct: number; productIds: string[] }[], lines: ComboLine[]): OwnedDiscount {
  const cartProductIds = new Set(lines.map((l) => l.productId));
  const best = new Map<string, { pct: number; id: string }>();
  for (const combo of combos) {
    if (!combo.pct || combo.pct <= 0 || new Set(combo.productIds).size < MIN_COMBO_PRODUCTS) continue;
    const allPresent = combo.productIds.every((pid) => cartProductIds.has(pid));
    if (!allPresent) continue;
    for (const pid of combo.productIds) {
      const cur = best.get(pid);
      if (!cur || combo.pct > cur.pct) best.set(pid, { pct: combo.pct, id: combo.id });
    }
  }
  const perLine: Record<string, number> = {};
  const owner: Record<string, string> = {};
  let total = 0;
  for (const line of lines) {
    const hit = best.get(line.productId);
    if (!hit) continue;
    const d = Math.floor((line.total * Math.min(hit.pct, 100)) / 100);
    if (d > 0) {
      perLine[line.variationId] = d;
      owner[line.variationId] = hit.id;
      total += d;
    }
  }
  return { total, perLine, owner };
}

/** Dòng duy nhất của một sản phẩm của combo (combo đã khớp): bỏ MỘT mình dòng đó thì sản phẩm vắng mặt và combo không còn khớp. Sản phẩm có hai phân loại trong giỏ thì không dòng nào là khoá. */
export function comboKeyVariationIds(productIds: string[], lines: ComboLine[]): string[] {
  const keys: string[] = [];
  for (const pid of new Set(productIds)) {
    const rows = lines.filter((l) => l.productId === pid);
    if (rows.length === 0) return [];
    if (rows.length === 1) keys.push(rows[0]!.variationId);
  }
  return keys.sort();
}

/** Nguồn của một chủ trong `OwnedDiscount.owner`: loại, tên và dòng khoá của combo đó. */
export interface ComboSource {
  kind: ComboGroupKind;
  title: string;
  keyVariationIds: string[];
}

const FALLBACK_SOURCE: ComboSource = { kind: 'BUNDLE_PCT', title: 'Combo', keyVariationIds: [] };

/**
 * Chia `perLine` đã gộp theo chủ thành nhóm (THUẦN). Chủ lạ (không có trong `sources`) vẫn thành nhóm dự phòng để tổng các nhóm luôn bằng `total`,
 * không bao giờ làm mất khoản giảm khỏi nhóm.
 */
export function buildComboGroups(merged: OwnedDiscount, sources: ReadonlyMap<string, ComboSource>): ComboGroup[] {
  const groups = new Map<string, ComboGroup>();
  for (const variationId of Object.keys(merged.perLine).sort()) {
    const id = merged.owner[variationId] ?? 'combo:other';
    const src = sources.get(id) ?? FALLBACK_SOURCE;
    const g = groups.get(id) ?? { id, kind: src.kind, title: src.title, discount: 0, variationIds: [], keyVariationIds: [...src.keyVariationIds] };
    g.discount += merged.perLine[variationId]!;
    g.variationIds.push(variationId);
    groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

const NO_MATCH: ComboMatch = { total: 0, perLine: {}, groups: [] };
const NO_OWNED: OwnedDiscount = { total: 0, perLine: {}, owner: {} };

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
    const { total, perLine } = await this.computeWithGroups(slug, lines, buyerId, now);
    return { total, perLine };
  }

  /**
   * Cùng một lần khớp với `computeForStorefront` (nó gọi hàm này rồi bỏ `groups`) nhưng chia thêm khoản giảm theo combo để giỏ nói khách món nào thuộc bộ nào.
   * `Σ groups.discount === total`; tiền không đổi.
   */
  async computeWithGroups(slug: string | null | undefined, lines: ComboLine[], buyerId?: string, now: Date = new Date()): Promise<ComboMatch> {
    if (lines.length === 0) return NO_MATCH;
    const store = await this.storefrontCombo(slug, lines, buyerId);
    const live = await loadLiveBundles(this.prisma, now, [...new Set(lines.map((l) => l.productId))]);
    const bundles = await this.withoutOwnStaffBundles(live, buyerId);
    if (bundles.length === 0) return matchOf(store.owned, store.sources);
    const maxPct = await readBundleMaxPct(this.config);
    const bundleLines = lines.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total, quantity: l.quantity ?? 1 }));
    // Trần chỉ kiểm từng bộ lúc ghi nên không chặn nhiều bộ cộng dồn hay giá tăng sau khi lưu: kẹp tổng bộ của nhân viên ở đây, nơi tiền thật mất đi.
    const staffMax = (await loadStaffCouponCaps(this.config)).maxAmount;
    const raw = allocateBundleDiscountsOwned(bundles, bundleLines, maxPct);
    // `raw` là cận trên của mọi kết quả sau khi kẹp: chưa vượt trần thì không bộ nào bị kẹp, khỏi tra vai trò người tạo.
    const bundle = raw.total <= staffMax ? raw : allocateBundleDiscountsCappedOwned(bundles, bundleLines, maxPct, { isStaff: await this.staffBundlePredicate(bundles), maxAmount: staffMax });
    const sources = new Map(store.sources);
    for (const b of bundles) sources.set(`bundle:${b.id}`, { kind: b.kind, title: b.title ?? 'Combo', keyVariationIds: bundleKeyVariationIds(b, bundleLines) });
    return matchOf(mergeMaxOwned(store.owned, bundle), sources);
  }

  /**
   * Bộ do ADMIN tạo không bị trần nhân viên; mọi bộ khác bị kẹp, kể cả không rõ người tạo (`createdById` null, tài khoản không còn), cùng chiều với
   * `isOwnStaffCoupon` (không rõ vai trò coi như nhân viên). Một truy vấn cho mọi người tạo của các bộ đang xét.
   */
  private async staffBundlePredicate(bundles: readonly LiveBundle[]): Promise<(b: LiveBundle) => boolean> {
    const creatorIds = [...new Set(bundles.map((b) => b.createdById).filter((id): id is string => id !== null))];
    const admins = creatorIds.length === 0 ? [] : await this.prisma.user.findMany({ where: { id: { in: creatorIds }, role: 'ADMIN' }, select: { id: true } });
    const adminIds = new Set(admins.map((u) => u.id));
    return (b) => b.createdById === null || !adminIds.has(b.createdById);
  }

  /**
   * Nhân viên (không phải ADMIN) không hưởng bộ do chính mình tạo: cùng luật mã giảm giá (`isOwnStaffCoupon`) và Giờ vàng
   * (`ownSalesBlocked`), vì bộ không có quota toàn cục nên tự tạo rồi tự đặt nhiều đơn là tự cấp tiền. Chỉ tra vai trò khi người mua
   * thật sự là người tạo một bộ đang xét. API công khai không biết người mua (cache chung) nên vẫn quảng cáo; giỏ chỉ giảm ít hơn.
   */
  private async withoutOwnStaffBundles(bundles: LiveBundle[], buyerId: string | undefined): Promise<LiveBundle[]> {
    if (!buyerId || !bundles.some((b) => b.createdById === buyerId)) return bundles;
    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId }, select: { role: true } });
    const user = { id: buyerId, role: buyer?.role };
    return bundles.filter((b) => !isOwnStaffBundle(b, user));
  }

  private async storefrontCombo(slug: string | null | undefined, lines: ComboLine[], buyerId?: string): Promise<{ owned: OwnedDiscount; sources: Map<string, ComboSource> }> {
    const none = { owned: NO_OWNED, sources: new Map<string, ComboSource>() };
    if (!slug) return none;
    const sf = await this.prisma.storefront.findFirst({
      where: { slug, ...publicStorefrontWhere(await loadPublicVisibility(this.config)) },
      select: {
        ownerUserId: true,
        collections: {
          where: { kind: 'COMBO' },
          select: {
            id: true,
            title: true,
            comboDiscountPct: true,
            items: { select: { productId: true, isHidden: true, product: { select: { storefrontId: true } } } },
          },
        },
      },
    });
    if (!sf) return none;
    if (buyerId && sf.ownerUserId === buyerId) return none;
    // Clamp LẦN 2 tại nơi đọc — phòng dữ liệu ghi từ trước khi StorefrontService có trần
    // (hoặc ghi thẳng DB) vẫn không cho phép combo vượt trần hiện hành (P0,
    // docs/2026-09-08-review-progress.md). StorefrontService.clampComboPct là lớp chính (chặn
    // lúc ghi); đây là lớp phòng thủ thứ 2 (chặn lúc tính tiền — nơi tiền thật mất đi).
    const maxPct = await this.config.get<number>('storefront.max_combo_pct', 30);
    const combos = sf.collections
      .map((c) => ({
        id: `collection:${c.id}`,
        title: c.title,
        pct: Math.min(c.comboDiscountPct ?? 0, maxPct),
        // SP ẩn không tính vào điều kiện combo (CTV ẩn tạm → vẫn render được combo phần còn lại). Hàng của gian hàng đối tác
        // cũng vậy: chỉ bán giá lẻ, không được giảm combo (partner-goods.ts).
        productIds: c.items.filter((i) => !i.isHidden && !isPartnerOwnedProduct(i.product)).map((i) => i.productId),
      }))
      .filter((c) => c.productIds.length > 0);
    const sources = new Map<string, ComboSource>(
      combos.map((c) => [c.id, { kind: 'STOREFRONT', title: c.title, keyVariationIds: comboKeyVariationIds(c.productIds, lines) }]),
    );
    return { owned: allocateComboDiscountsOwned(combos, lines), sources };
  }
}

function matchOf(merged: OwnedDiscount, sources: ReadonlyMap<string, ComboSource>): ComboMatch {
  return { total: merged.total, perLine: merged.perLine, groups: buildComboGroups(merged, sources) };
}
