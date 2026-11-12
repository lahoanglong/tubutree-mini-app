import { baseSlug, isBlankHtmlText } from './catalog-text';

/**
 * Kiểm tra chất lượng catalog (Admin): module thuần, không gọi mạng. Nhận danh sách sản phẩm đã đọc, trả số đếm và các dòng lỗi để ops sửa ngay trên Pancake.
 *
 * Ba loại lỗi, xếp từ nặng đến nhẹ theo mức khách thấy:
 * - `known_media_mismatch`: ảnh đang gắn lệch với tên SKU. Danh sách ở `KNOWN_MEDIA_MISMATCHES` do người xem ảnh bao bì lập tay (không suy ra tự động), mỗi mục ghi
 *   địa chỉ ảnh Pancake đang sai. Ops đổi ảnh thì địa chỉ đổi và cảnh báo tự hết; không cần sửa mã.
 * - `missing_thumbnail`: PROD chưa có ảnh đại diện.
 * - `empty_native_description`: mô tả gốc trong DB trống, trang sản phẩm đang dựa vào chữ dự phòng (`product-copy-fallback.ts`) hoặc để trống.
 *   Chỉ xét khi đã đọc được mô tả (`description !== undefined`): chưa đọc được thì không báo, tránh báo oan.
 */
export type CatalogIssueKind = 'known_media_mismatch' | 'missing_thumbnail' | 'empty_native_description';

/** Thứ tự từ nặng đến nhẹ; dùng để sắp dòng và liệt kê số đếm. */
export const CATALOG_ISSUE_KINDS: readonly CatalogIssueKind[] = ['known_media_mismatch', 'missing_thumbnail', 'empty_native_description'];

export const CATALOG_ISSUE_LABELS: Record<CatalogIssueKind, string> = {
  known_media_mismatch: 'Ảnh lệch tên',
  missing_thumbnail: 'Thiếu ảnh',
  empty_native_description: 'Trống mô tả',
};

export interface AuditProduct {
  slug: string;
  name: string;
  /** Ảnh đại diện Pancake; null hoặc rỗng là thiếu ảnh. */
  thumbnail?: string | null;
  /** Mô tả gốc của DB (chưa bù chữ dự phòng). `undefined` = chưa đọc được, không xét. */
  description?: string | null;
  inStock?: boolean;
}

export interface KnownMediaMismatch {
  /** Slug gốc đã bỏ hậu tố băm Pancake. */
  baseSlug: string;
  /** Ảnh Pancake đang sai (khớp tuyệt đối sau khi bỏ phần truy vấn). Ảnh đổi sang địa chỉ khác thì mục này hết hiệu lực. */
  badThumbnail: string;
  /** Điều ảnh đang thể hiện, đọc từ chính ảnh. */
  shows: string;
}

/** Đối chiếu ảnh bao bì ngày 12/11/2026 (xem lại từng ảnh trước khi thêm mục mới). */
export const KNOWN_MEDIA_MISMATCHES: readonly KnownMediaMismatch[] = [
  {
    baseSlug: 'nuoc-rua-chen-fuwa3e-100ml',
    badThumbnail: 'https://content.pancake.vn/2-2608/2026/8/14/f74ce91cced04e2b63f2698dd36ec094c3bb7e18.png',
    shows: 'chai nước rửa chén nhưng tiêu đề ảnh ghi "Vệ sinh bồn cầu Eco Enzyme 100ml"',
  },
  {
    baseSlug: 've-sinh-nha-tam-va-toilet-fuwa3e-100ml',
    badThumbnail: 'https://content.pancake.vn/2-2608/2026/8/14/800b43556adbcf63f39f064f877f6a8ed1f39dbc.png',
    shows: 'sản phẩm "Vệ sinh bồn cầu" 100ml',
  },
  {
    baseSlug: 've-sinh-nha-tam-va-toilet-fuwa3e-500ml',
    badThumbnail: 'https://content.pancake.vn/2-2608/2026/8/14/2a9380a85f3494d35a5416f69f5e936ea80c8fa7.png',
    shows: 'sản phẩm "Vệ sinh bồn cầu sinh học" 500ml',
  },
  {
    baseSlug: 'dau-rua-mat-po-lang-100ml-55ml',
    badThumbnail: 'https://content.pancake.vn/2-25/2025/5/30/bfc15613a6d2918b721ca137d25e695c3522dd2b.png',
    shows: 'chai "Dầu tẩy trang Pơ Lang 55ml", không thấy bản 100ml',
  },
];

export interface CatalogIssue {
  kind: CatalogIssueKind;
  /** Câu tiếng Việt nói rõ lỗi gì và nên làm gì. */
  detail: string;
}

export interface CatalogIssueRow {
  slug: string;
  name: string;
  inStock?: boolean;
  issues: CatalogIssue[];
}

export interface CatalogAuditSummary {
  total: number;
  /** Số sản phẩm có ít nhất một lỗi. */
  flagged: number;
  /** Trong số đó, số đang còn hàng (khách đang thấy). */
  flaggedInStock: number;
  /** Số sản phẩm dính từng loại lỗi (một sản phẩm có thể dính nhiều loại). */
  byKind: Record<CatalogIssueKind, number>;
}

export interface CatalogAuditResult {
  summary: CatalogAuditSummary;
  /** Chỉ các dòng có lỗi: còn hàng trước, rồi lỗi nặng nhất, rồi nhiều lỗi hơn, rồi theo tên. */
  rows: CatalogIssueRow[];
}

export interface CatalogAuditOptions {
  /** Cho biết slug có chữ dự phòng không, để câu nói rõ trang sản phẩm đang hiện gì. Không truyền thì câu nói chung. */
  hasFallbackCopy?: (slug: string) => boolean;
}

const bareUrl = (u: string): string => u.trim().split(/[?#]/)[0] ?? '';

const MISMATCH_BY_SLUG: ReadonlyMap<string, KnownMediaMismatch> = new Map(KNOWN_MEDIA_MISMATCHES.map((m) => [m.baseSlug, m]));

function issuesOf(p: AuditProduct, opts: CatalogAuditOptions): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  const thumb = p.thumbnail ? bareUrl(p.thumbnail) : '';
  const known = MISMATCH_BY_SLUG.get(baseSlug(p.slug));
  if (known && thumb !== '' && thumb === bareUrl(known.badThumbnail)) {
    out.push({
      kind: 'known_media_mismatch',
      detail: `Ảnh đang thể hiện ${known.shows}, không khớp tên "${p.name}". Thay ảnh trong Pancake; cảnh báo tự hết khi ảnh đổi.`,
    });
  }
  if (thumb === '') {
    out.push({ kind: 'missing_thumbnail', detail: 'Chưa có ảnh đại diện. Thêm ảnh sản phẩm trong Pancake.' });
  }
  if (p.description !== undefined && isBlankHtmlText(p.description)) {
    const fb = opts.hasFallbackCopy?.(p.slug);
    const shown = fb === undefined ? 'Trang sản phẩm đang dùng chữ dự phòng nếu có, nếu không thì để trống phần mô tả.' : fb ? 'Trang sản phẩm đang hiện chữ dự phòng.' : 'Trang sản phẩm đang để trống phần mô tả.';
    out.push({ kind: 'empty_native_description', detail: `Mô tả gốc trống. ${shown} Điền mô tả trong Pancake.` });
  }
  return out;
}

const severity = (r: CatalogIssueRow): number => Math.min(...r.issues.map((i) => CATALOG_ISSUE_KINDS.indexOf(i.kind)));

export function auditCatalogProducts(products: readonly AuditProduct[], opts: CatalogAuditOptions = {}): CatalogAuditResult {
  const byKind: Record<CatalogIssueKind, number> = { known_media_mismatch: 0, missing_thumbnail: 0, empty_native_description: 0 };
  const rows: CatalogIssueRow[] = [];
  for (const p of products) {
    const issues = issuesOf(p, opts);
    if (issues.length === 0) continue;
    for (const i of issues) byKind[i.kind] += 1;
    rows.push({ slug: p.slug, name: p.name, ...(p.inStock === undefined ? null : { inStock: p.inStock }), issues });
  }
  rows.sort(
    (a, b) =>
      Number(a.inStock === false) - Number(b.inStock === false) ||
      severity(a) - severity(b) ||
      b.issues.length - a.issues.length ||
      a.name.localeCompare(b.name, 'vi') ||
      a.slug.localeCompare(b.slug),
  );
  return {
    summary: { total: products.length, flagged: rows.length, flaggedInStock: rows.filter((r) => r.inStock !== false).length, byKind },
    rows,
  };
}
