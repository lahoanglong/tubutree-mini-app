/**
 * Link CTV tới một đích cụ thể (Trang chủ, Giờ vàng, một sản phẩm, một danh mục), dùng chung Mini App và web: dựng đường dẫn có `?ref=` (mã CTV)
 * và `&l=` (mã link), đặt tên dòng link, số liệu từng link, ảnh QR của link, và câu phễu "lượt bấm → đơn" của CTV.
 *
 * Đơn lưu mã link (`orders.affiliateLinkCode`, PO A4 24/11/2026): mỗi link có lượt bấm, số đơn có hoa hồng và doanh số (nền hoa hồng) của riêng
 * nó, trừ đơn huỷ/trả. Đơn đặt trước khi có cột này không mang mã nên không vào số của link nào. Câu phễu trên danh sách vẫn là số chung của CTV
 * (mọi link, gian hàng, mã giới thiệu, đơn đặt hộ).
 */
import type { PosterInput } from './share-poster-link';
import { vnd } from './money';


export type AffiliateLinkTarget = 'HOMEPAGE' | 'PRODUCT' | 'CATEGORY' | 'DEAL';
export type AffiliateLinkPlatform = 'web' | 'miniapp';

/** Thứ tự và nhãn của bộ chọn đích (cùng tập giá trị với `CreateLinkDto.targetType` của API). */
export const AFFILIATE_LINK_TARGETS: readonly { key: AffiliateLinkTarget; label: string }[] = [
  { key: 'HOMEPAGE', label: 'Trang chủ' },
  { key: 'PRODUCT', label: 'Sản phẩm' },
  { key: 'CATEGORY', label: 'Danh mục' },
  { key: 'DEAL', label: 'Giờ vàng' },
];

/** Đích cần chọn thêm một sản phẩm hoặc danh mục trước khi tạo link. */
export const linkTargetNeedsPick = (t: AffiliateLinkTarget): boolean => t === 'PRODUCT' || t === 'CATEGORY';

export const isAffiliateLinkTarget = (v: string): v is AffiliateLinkTarget => AFFILIATE_LINK_TARGETS.some((t) => t.key === v);

/** Đường dẫn mỗi nền tảng (route-map.json: /product/:slug ↔ /san-pham/:slug, /browse ↔ /san-pham, /flash-sale ↔ /gio-vang). */
const PATHS: Record<AffiliateLinkPlatform, { home: string; product: string; browse: string; deal: string }> = {
  web: { home: '/', product: '/san-pham', browse: '/san-pham', deal: '/gio-vang' },
  miniapp: { home: '/', product: '/product', browse: '/browse', deal: '/flash-sale' },
};

/** Cùng khuôn với `withReferral`/entry-source của hai app; mã khác khuôn bị bỏ khỏi URL. */
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

export interface AffiliateLinkLike {
  shortCode: string;
  targetType: string;
  targetId?: string | null;
  targetSlug?: string | null;
  targetLabel?: string | null;
  /** false: sản phẩm đã ngừng hiện hoặc danh mục đã bị xoá. Thiếu (API cũ) coi như còn. */
  targetAvailable?: boolean;
  /** true: sản phẩm vẫn bán nhưng đã bị tắt hoa hồng CTV sau khi tạo link. */
  targetCommissionBlocked?: boolean;
}

/** Link còn mở đúng đích không; đích mất (hoặc thiếu slug/id) thì link mở Trang chủ thay vì trang lỗi. */
export function linkOpensTarget(link: AffiliateLinkLike): boolean {
  if (link.targetAvailable === false) return false;
  if (link.targetType === 'PRODUCT') return Boolean(link.targetSlug?.trim());
  if (link.targetType === 'CATEGORY') return Boolean(link.targetId?.trim());
  return link.targetType === 'HOMEPAGE' || link.targetType === 'DEAL';
}

/** Đường dẫn tới đích của link (kèm `category=` nếu là danh mục), chưa có `ref`/`l`. */
function targetPath(link: AffiliateLinkLike, platform: AffiliateLinkPlatform): { path: string; params: string[] } {
  const p = PATHS[platform];
  if (!linkOpensTarget(link)) return { path: p.home, params: [] };
  if (link.targetType === 'PRODUCT') return { path: `${p.product}/${encodeURIComponent(link.targetSlug!.trim())}`, params: [] };
  if (link.targetType === 'CATEGORY') return { path: p.browse, params: [`category=${encodeURIComponent(link.targetId!.trim())}`] };
  return { path: link.targetType === 'DEAL' ? p.deal : p.home, params: [] };
}

/**
 * Đường dẫn (không gồm gốc) của một link CTV: web `/san-pham/<slug>?ref=…&l=…`, `/san-pham?category=<id>&ref=…&l=…`, `/gio-vang?ref=…&l=…`;
 * Mini App cùng dạng với `/product`, `/browse`, `/flash-sale`. Ghép với `SITE_URL` (web) hoặc `miniAppLink()` (Mini App).
 */
export function affiliateLinkPath(link: AffiliateLinkLike, affiliateCode: string, platform: AffiliateLinkPlatform): string {
  const { path, params } = targetPath(link, platform);
  if (REF_CODE_PATTERN.test(affiliateCode)) params.push(`ref=${affiliateCode}`);
  if (LINK_CODE_PATTERN.test(link.shortCode)) params.push(`l=${link.shortCode}`);
  return params.length > 0 ? `${path}?${params.join('&')}` : path;
}

/**
 * Ảnh QR (bộ vẽ chung `share-poster.ts`) của một link: QR trỏ trang web công khai của đúng đích, kèm `ref` và `l` của link nên khách quét ảnh
 * vẫn được tính vào link đó. Link sản phẩm còn mở thì vẽ thẻ sản phẩm, còn lại vẽ ảnh kiểu gian hàng với tên dòng link.
 */
export function affiliateLinkPoster(link: AffiliateLinkLike, affiliateCode: string | null | undefined): PosterInput {
  const linkCode = LINK_CODE_PATTERN.test(link.shortCode) ? link.shortCode : null;
  if (link.targetType === 'PRODUCT' && linkOpensTarget(link)) {
    return { kind: 'product', name: link.targetLabel?.trim() || affiliateLinkTitle(link), slug: link.targetSlug!.trim(), referralCode: affiliateCode, linkCode };
  }
  const { path, params } = targetPath(link, 'web');
  return { kind: 'store', title: affiliateLinkTitle(link), path: params.length > 0 ? `${path}?${params.join('&')}` : path, referralCode: affiliateCode, linkCode };
}

const TARGET_LABEL = Object.fromEntries(AFFILIATE_LINK_TARGETS.map((t) => [t.key, t.label])) as Record<AffiliateLinkTarget, string>;

/** Tên dòng link: "Trang chủ", "Giờ vàng", "Sản phẩm · <tên>", "Danh mục · <tên>". Loại lạ (API mới hơn app) gọi chung là "Link". */
export function affiliateLinkTitle(link: Pick<AffiliateLinkLike, 'targetType' | 'targetLabel'>): string {
  if (!isAffiliateLinkTarget(link.targetType)) return 'Link';
  const kind = TARGET_LABEL[link.targetType];
  const name = link.targetLabel?.trim();
  return name && linkTargetNeedsPick(link.targetType) ? `${kind} · ${name}` : kind;
}

export interface AffiliateLinkStats {
  clicks: number;
  orders: number;
  /** Phần trăm đơn trên lượt bấm của riêng link, một chữ số thập phân; null khi chưa có lượt bấm hoặc số đơn vượt số lượt bấm. */
  ratePct: number | null;
  /** Doanh số (tiền hàng có hoa hồng) của các đơn đến từ link, trừ đơn huỷ/trả. */
  revenue: number;
}

const safeCount = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** Số liệu một link từ dòng API (`clicks`, `conversions`, `revenue`); thiếu trường (API cũ) coi là 0. */
export function affiliateLinkStats(link: { clicks: number; conversions?: number; revenue?: number }): AffiliateLinkStats {
  const clicks = safeCount(link.clicks);
  const orders = safeCount(link.conversions);
  return { clicks, orders, ratePct: rateOf(orders, clicks), revenue: safeCount(link.revenue) };
}

function rateOf(orders: number, clicks: number): number | null {
  return clicks > 0 && orders <= clicks ? Math.round((orders / clicks) * 1000) / 10 : null;
}

/**
 * Dòng phụ của một link: "12 lượt bấm · 3 đơn (25%) · 1.250.000đ" (đơn và doanh số của riêng link). Đích đã mất thì nói link đang mở Trang chủ; sản
 * phẩm đã bị tắt hoa hồng thì nói rõ để CTV ngừng gửi link không còn tính tiền. Chữ số đều bề rộng: nơi hiện đặt `tabular-nums`.
 */
export function affiliateLinkCaption(link: AffiliateLinkLike & { clicks: number; conversions?: number; revenue?: number }): string {
  const s = affiliateLinkStats(link);
  // 0 đơn thì "(0%)" không nói thêm gì: bỏ cho dòng gọn.
  const orders = `${s.orders} đơn${s.ratePct === null || s.orders === 0 ? '' : ` (${pctText(s.ratePct)})`}`;
  const numbers = `${s.clicks} lượt bấm · ${orders}${s.revenue > 0 ? ` · ${vnd(s.revenue)}` : ''}`;
  if (!isAffiliateLinkTarget(link.targetType)) return numbers;
  if (!linkOpensTarget(link)) return `${numbers} · Đích không còn, link mở Trang chủ`;
  return link.targetType === 'PRODUCT' && link.targetCommissionBlocked ? `${numbers} · Sản phẩm không còn tính hoa hồng` : numbers;
}

export interface CtvFunnel {
  clicks: number;
  orders: number;
  /** Phần trăm đơn trên lượt bấm, một chữ số thập phân; null khi chưa có lượt bấm hoặc số đơn vượt số lượt bấm (đơn đến từ kênh khác). */
  ratePct: number | null;
}

export function ctvFunnel(d: { totalClicks?: number; totalConversions?: number } | undefined): CtvFunnel {
  const clicks = Math.max(0, d?.totalClicks ?? 0);
  const orders = Math.max(0, d?.totalConversions ?? 0);
  return { clicks, orders, ratePct: rateOf(orders, clicks) };
}

const pctText = (n: number) => `${String(n).replace('.', ',')}%`;

/** Nút mở ảnh QR của một link (nhãn cho trình đọc màn hình, nút chỉ có biểu tượng) và tiêu đề bảng ảnh. */
export const LINK_POSTER_COPY = {
  open: 'Ảnh QR của link',
  title: 'Ảnh QR của link',
} as const;

/** Chữ của bộ tạo link (sheet "Tạo link"), dùng chung hai app. */
export const LINK_BUILDER_COPY = {
  title: 'Tạo link chia sẻ',
  targetLabel: 'Link mở tới',
  searchProduct: 'Tìm sản phẩm có hoa hồng',
  pickProduct: 'Chọn một sản phẩm',
  pickCategory: 'Chọn một danh mục',
  picked: 'Đã chọn:',
  noProduct: 'Không có sản phẩm hợp với từ khoá.',
  noCategory: 'Chưa có danh mục nào đang bán.',
  loadError: 'Chưa tải được danh sách.',
  homeHint: 'Khách mở Trang chủ Tubu Tree.',
  dealHint: 'Khách mở trang Giờ vàng đang diễn ra.',
  submit: 'Tạo link',
  submitting: 'Đang tạo…',
  created: 'Đã tạo link, chạm Sao chép để gửi khách.',
  copy: 'Sao chép',
  copied: 'Đã sao chép link',
  copyFail: 'Không sao chép được, hãy chép link thủ công.',
} as const;

/** Dòng phụ của khoản hoa hồng LOCKED thuộc đơn khách vãng lai chưa thu tiền (≤ 40 ký tự, cùng cỡ dòng ngày chốt). */
export const COMMISSION_AWAITING_PAYMENT_NOTE = 'Chốt sau khi đơn thanh toán xong';

/**
 * Ngày khoản hoa hồng đang giữ (LOCKED) dự kiến được chốt: máy chủ tính `lockedAt` (lúc đơn giao) + số ngày giữ thực. Chỉ là dự kiến,
 * vì đơn còn yêu cầu đổi/trả chờ duyệt thì chưa chốt. `formatDate` là hàm ngày của từng app (web giờ VN, Mini theo máy).
 * Đơn khách vãng lai chưa thu tiền (`awaitingPayment`, PO A3) không có ngày: hoa hồng chỉ chốt sau khi đơn thanh toán xong.
 */
export function commissionUnlockNote(c: { status: string; unlockEstimateAt?: string | null; awaitingPayment?: boolean }, formatDate: (iso: string) => string): string | null {
  if (c.status === 'LOCKED' && c.awaitingPayment === true) return COMMISSION_AWAITING_PAYMENT_NOTE;
  if (c.status !== 'LOCKED' || !c.unlockEstimateAt || Number.isNaN(Date.parse(c.unlockEstimateAt))) return null;
  return `Dự kiến chốt từ ${formatDate(c.unlockEstimateAt)} nếu không có đổi/trả`;
}

/** Một lựa chọn danh mục trong bộ tạo link. */
export interface LinkCategoryOption {
  id: string;
  label: string;
}
interface CategoryLike {
  id: string;
  name: string;
  productCount?: number;
  children?: CategoryLike[];
}

/** Cây danh mục thành danh sách phẳng theo thứ tự, tên con kèm tên cha; bỏ danh mục API báo không còn hàng đang bán (thiếu số đếm thì giữ). */
export function linkCategoryOptions(tree: readonly CategoryLike[] | undefined): LinkCategoryOption[] {
  const out: LinkCategoryOption[] = [];
  const seen = new Set<string>();
  const walk = (nodes: readonly CategoryLike[], parent: string | null) => {
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.productCount === undefined || n.productCount > 0) out.push({ id: n.id, label: parent ? `${parent} › ${n.name}` : n.name });
      if (n.children?.length) walk(n.children, n.name);
    }
  };
  walk(tree ?? [], null);
  return out;
}
