/**
 * Link CTV tới một đích cụ thể (Trang chủ, Giờ vàng, một sản phẩm, một danh mục), dùng chung Mini App và web: dựng đường dẫn có `?ref=` (mã CTV)
 * và `&l=` (mã link, để đếm lượt bấm), đặt tên dòng link, và câu phễu "lượt bấm → đơn" của CTV.
 *
 * Thiết kế không thêm cột (PO A3): đơn không lưu mã link, nên số trên từng link CHỈ là lượt bấm. Số đơn và tỉ lệ ra đơn là số chung của CTV
 * (mọi link, gian hàng, mã giới thiệu), chữ trên màn phải nói rõ như vậy.
 */

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

/**
 * Đường dẫn (không gồm gốc) của một link CTV: web `/san-pham/<slug>?ref=…&l=…`, `/san-pham?category=<id>&ref=…&l=…`, `/gio-vang?ref=…&l=…`;
 * Mini App cùng dạng với `/product`, `/browse`, `/flash-sale`. Ghép với `SITE_URL` (web) hoặc `miniAppLink()` (Mini App).
 */
export function affiliateLinkPath(link: AffiliateLinkLike, affiliateCode: string, platform: AffiliateLinkPlatform): string {
  const p = PATHS[platform];
  const params: string[] = [];
  let path = p.home;
  if (linkOpensTarget(link)) {
    if (link.targetType === 'PRODUCT') path = `${p.product}/${encodeURIComponent(link.targetSlug!.trim())}`;
    else if (link.targetType === 'CATEGORY') {
      path = p.browse;
      params.push(`category=${encodeURIComponent(link.targetId!.trim())}`);
    } else if (link.targetType === 'DEAL') path = p.deal;
  }
  if (REF_CODE_PATTERN.test(affiliateCode)) params.push(`ref=${affiliateCode}`);
  if (LINK_CODE_PATTERN.test(link.shortCode)) params.push(`l=${link.shortCode}`);
  return params.length > 0 ? `${path}?${params.join('&')}` : path;
}

const TARGET_LABEL = Object.fromEntries(AFFILIATE_LINK_TARGETS.map((t) => [t.key, t.label])) as Record<AffiliateLinkTarget, string>;

/** Tên dòng link: "Trang chủ", "Giờ vàng", "Sản phẩm · <tên>", "Danh mục · <tên>". Loại lạ (API mới hơn app) gọi chung là "Link". */
export function affiliateLinkTitle(link: Pick<AffiliateLinkLike, 'targetType' | 'targetLabel'>): string {
  if (!isAffiliateLinkTarget(link.targetType)) return 'Link';
  const kind = TARGET_LABEL[link.targetType];
  const name = link.targetLabel?.trim();
  return name && linkTargetNeedsPick(link.targetType) ? `${kind} · ${name}` : kind;
}

/**
 * Dòng phụ của một link: chỉ là lượt bấm (đơn không lưu mã link). Đích đã mất thì nói link đang mở Trang chủ; sản phẩm đã bị tắt hoa hồng thì nói
 * rõ để CTV ngừng gửi link không còn tính tiền.
 */
export function affiliateLinkCaption(link: AffiliateLinkLike & { clicks: number }): string {
  const clicks = `${Math.max(0, link.clicks)} lượt bấm`;
  if (!isAffiliateLinkTarget(link.targetType)) return clicks;
  if (!linkOpensTarget(link)) return `${clicks} · Đích không còn, link mở Trang chủ`;
  return link.targetType === 'PRODUCT' && link.targetCommissionBlocked ? `${clicks} · Sản phẩm không còn tính hoa hồng` : clicks;
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
  const ratePct = clicks > 0 && orders <= clicks ? Math.round((orders / clicks) * 1000) / 10 : null;
  return { clicks, orders, ratePct };
}

const pctText = (n: number) => `${String(n).replace('.', ',')}%`;

/**
 * Một dòng tóm tắt phễu của CTV, đặt trên danh sách link. Số đơn gồm cả đơn từ gian hàng, mã giới thiệu và đơn đặt hộ, còn lượt bấm chỉ đến từ link,
 * nên nhãn ghi "chung" (không phải tỉ lệ của riêng link); `CTV_FUNNEL_NOTE` nói rõ bên dưới.
 */
export function ctvFunnelLine(f: CtvFunnel): string {
  if (f.clicks === 0 && f.orders === 0) return 'Chưa có lượt bấm nào. Gửi link đầu tiên để bắt đầu.';
  const ratio = `${f.orders} đơn / ${f.clicks} lượt bấm`;
  return f.ratePct === null ? ratio : `Tỉ lệ ra đơn chung ${pctText(f.ratePct)} · ${ratio}`;
}

/** Ghi chú dưới dòng phễu: nói rõ số nào tính chung, số nào theo link. */
export const CTV_FUNNEL_NOTE = 'Số trên từng link là lượt bấm. Đơn tính chung cho mọi link, gian hàng, mã giới thiệu và đơn đặt hộ của bạn.';

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

/**
 * Ngày khoản hoa hồng đang giữ (LOCKED) dự kiến được chốt: máy chủ tính `lockedAt` (lúc đơn giao) + số ngày giữ thực. Chỉ là dự kiến,
 * vì đơn còn yêu cầu đổi/trả chờ duyệt thì chưa chốt. `formatDate` là hàm ngày của từng app (web giờ VN, Mini theo máy).
 */
export function commissionUnlockNote(c: { status: string; unlockEstimateAt?: string | null }, formatDate: (iso: string) => string): string | null {
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
