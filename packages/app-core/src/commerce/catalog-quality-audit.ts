import { formatVnNumber } from '../number-format';
import { baseSlug, isBlankHtmlText } from './catalog-text';
import type { CatalogAuditProductDto } from '@tubutree/shared-types';

/**
 * Kiểm tra chất lượng catalog (Admin): module thuần, không gọi mạng. Nhận danh sách sản phẩm đã đọc, trả số đếm và các dòng lỗi để ops sửa ngay trên Pancake.
 *
 * Sáu loại lỗi, xếp từ nặng đến nhẹ theo mức khách thấy:
 * - `known_media_mismatch`: ảnh đang gắn lệch với tên SKU. Danh sách ở `KNOWN_MEDIA_MISMATCHES` do người xem ảnh bao bì lập tay (không suy ra tự động), mỗi mục ghi
 *   địa chỉ ảnh Pancake đang sai. Ops đổi ảnh thì địa chỉ đổi và cảnh báo tự hết; không cần sửa mã.
 * - `missing_thumbnail`: PROD chưa có ảnh đại diện.
 * - `invalid_retail_price`, `placeholder_stock`, `unnamed_variation`: lỗi cấp biến thể. Chỉ xét khi sản phẩm có `variations` (danh sách công khai của Mini không trả biến thể,
 *   thiếu thì bỏ qua để khỏi báo oan). Xét cả biến thể đang ẩn và sản phẩm đang ẩn: SKU ẩn giá 0 vẫn làm đồng bộ Pancake cảnh báo mỗi 15 phút.
 * - `empty_native_description`: mô tả gốc trong DB trống, trang sản phẩm đang dựa vào chữ dự phòng (`product-copy-fallback.ts`) hoặc để trống.
 *   Chỉ xét khi đã đọc được mô tả (`description !== undefined`): chưa đọc được thì không báo, tránh báo oan.
 */
export type CatalogIssueKind =
  | 'known_media_mismatch'
  | 'missing_thumbnail'
  | 'invalid_retail_price'
  | 'placeholder_stock'
  | 'unnamed_variation'
  | 'empty_native_description';

/** Thứ tự từ nặng đến nhẹ; dùng để sắp dòng và liệt kê số đếm. */
export const CATALOG_ISSUE_KINDS: readonly CatalogIssueKind[] = [
  'known_media_mismatch',
  'missing_thumbnail',
  'invalid_retail_price',
  'placeholder_stock',
  'unnamed_variation',
  'empty_native_description',
];

export const CATALOG_ISSUE_LABELS: Record<CatalogIssueKind, string> = {
  known_media_mismatch: 'Ảnh lệch tên',
  missing_thumbnail: 'Thiếu ảnh',
  invalid_retail_price: 'Giá bằng 0 hoặc sai',
  placeholder_stock: 'Tồn kho giả',
  unnamed_variation: 'Biến thể chưa đặt tên',
  empty_native_description: 'Trống mô tả',
};

/** Pancake để tồn "vô hạn" bằng số rất lớn; từ ngưỡng này trở lên coi là tồn giả (khách có thể đặt vượt số hàng thật). */
export const PLACEHOLDER_STOCK_MIN = 100000;

/**
 * Tình trạng mô tả của sản phẩm trên trang khách:
 * `native` mô tả gốc DB có chữ; `fallback` gốc trống nhưng slug có chữ dự phòng; `none` gốc trống và không có dự phòng (không truyền `hasFallbackCopy` cũng tính là `none`);
 * `unknown` chưa đọc được mô tả.
 */
export type CopyStatus = 'native' | 'fallback' | 'none' | 'unknown';

export const COPY_STATUS_LABELS: Record<CopyStatus, string> = {
  native: 'Đã có mô tả gốc DB',
  fallback: 'Đang dùng bản dự phòng',
  none: 'Chưa có mô tả',
  unknown: 'Chưa đọc được mô tả',
};

export const COPY_STATUSES: readonly CopyStatus[] = ['native', 'fallback', 'none', 'unknown'];

export interface AuditVariation {
  id: string;
  pancakeId: string | null;
  sku: string;
  name: string;
  stock: number;
  retailPrice: number;
  isActive: boolean;
}

export interface AuditProduct {
  slug: string;
  name: string;
  id?: string;
  pancakeId?: string | null;
  /** `false` là sản phẩm đang ẩn khỏi khách; vẫn được kiểm để ops sửa trước khi bật lại. */
  isActive?: boolean;
  /** Ảnh đại diện Pancake; null hoặc rỗng là thiếu ảnh. */
  thumbnail?: string | null;
  /** Mô tả gốc của DB (chưa bù chữ dự phòng). `undefined` = chưa đọc được, không xét. */
  description?: string | null;
  inStock?: boolean;
  /** Không có (Mini đọc danh sách công khai) thì bỏ qua mọi kiểm tra biến thể. */
  variations?: readonly AuditVariation[];
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
  /** Các biến thể dính lỗi (chỉ lỗi cấp biến thể), để xuất CSV và UI chỉ đúng SKU cần sửa. */
  variationIds?: string[];
}

export interface CatalogIssueRow {
  slug: string;
  name: string;
  id?: string;
  pancakeId?: string | null;
  isActive?: boolean;
  inStock?: boolean;
  copyStatus: CopyStatus;
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
  /** Tình trạng mô tả trên TẤT CẢ sản phẩm (không chỉ sản phẩm có lỗi). */
  copy: Record<CopyStatus, number>;
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

const MAX_SKUS_SHOWN = 3;

/** Máy chủ có thể trả tên biến thể là chuỗi hóa của object khi dữ liệu Pancake hỏng; chuỗi này có khi dính giữa hay sau tên thật, nên so khớp bằng `includes`. */
const BROKEN_VARIATION_NAME = '[object Object]';

const skuLabel = (v: AuditVariation): string => v.sku.trim() || v.pancakeId || v.id;

function skuList(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_SKUS_SHOWN).join(', ');
  return labels.length > MAX_SKUS_SHOWN ? `${shown} và ${labels.length - MAX_SKUS_SHOWN} SKU khác` : shown;
}

const isInvalidPrice = (v: AuditVariation): boolean => typeof v.retailPrice !== 'number' || !Number.isFinite(v.retailPrice) || v.retailPrice <= 0;
const isPlaceholderStock = (v: AuditVariation): boolean => v.stock >= PLACEHOLDER_STOCK_MIN;
/** Dùng chung với CSV sửa Pancake để cột `name` rơi về tên sản phẩm đúng ở những biến thể bị báo chưa đặt tên. */
export const isUnnamedVariation = (v: Pick<AuditVariation, 'name'>): boolean => typeof v.name !== 'string' || v.name.trim() === '' || v.name.includes(BROKEN_VARIATION_NAME);

const priceText = (n: number): string => (typeof n === 'number' && Number.isFinite(n) ? formatVnNumber(n) : 'không phải số');

function variationIssues(variations: readonly AuditVariation[]): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  const badPrice = variations.filter(isInvalidPrice);
  if (badPrice.length > 0) {
    out.push({
      kind: 'invalid_retail_price',
      detail: `Giá bán bằng 0 hoặc sai ở ${skuList(badPrice.map((v) => `${skuLabel(v)} (giá ${priceText(v.retailPrice)})`))}. Sửa giá bán của SKU trong Pancake; SKU đang ẩn mà giá 0 vẫn làm đồng bộ báo cảnh báo mỗi 15 phút.`,
      variationIds: badPrice.map((v) => v.id),
    });
  }
  const fakeStock = variations.filter(isPlaceholderStock);
  if (fakeStock.length > 0) {
    out.push({
      kind: 'placeholder_stock',
      detail: `Tồn kho từ ${formatVnNumber(PLACEHOLDER_STOCK_MIN)} trở lên là số giả ở ${skuList(fakeStock.map((v) => `${skuLabel(v)} (tồn ${formatVnNumber(v.stock)})`))}. Nhập tồn thật trong Pancake để khách không đặt quá số hàng đang có.`,
      variationIds: fakeStock.map((v) => v.id),
    });
  }
  const unnamed = variations.filter(isUnnamedVariation);
  if (unnamed.length > 0) {
    out.push({
      kind: 'unnamed_variation',
      detail: `Biến thể chưa đặt tên ở ${skuList(unnamed.map(skuLabel))}. Đặt tên biến thể (dung tích, mùi hương) trong Pancake để khách chọn được.`,
      variationIds: unnamed.map((v) => v.id),
    });
  }
  return out;
}

function copyStatusOf(p: AuditProduct, opts: CatalogAuditOptions): CopyStatus {
  if (p.description === undefined) return 'unknown';
  if (!isBlankHtmlText(p.description)) return 'native';
  return opts.hasFallbackCopy?.(p.slug) ? 'fallback' : 'none';
}

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
  if (p.variations) out.push(...variationIssues(p.variations));
  if (p.description !== undefined && isBlankHtmlText(p.description)) {
    const fb = opts.hasFallbackCopy?.(p.slug);
    const shown = fb === undefined ? 'Trang sản phẩm đang dùng chữ dự phòng nếu có, nếu không thì để trống phần mô tả.' : fb ? 'Trang sản phẩm đang hiện chữ dự phòng.' : 'Trang sản phẩm đang để trống phần mô tả.';
    out.push({ kind: 'empty_native_description', detail: `Mô tả gốc trống. ${shown} Điền mô tả trong Pancake.` });
  }
  return out;
}

const severity = (r: CatalogIssueRow): number => Math.min(...r.issues.map((i) => CATALOG_ISSUE_KINDS.indexOf(i.kind)));

export function auditCatalogProducts(products: readonly AuditProduct[], opts: CatalogAuditOptions = {}): CatalogAuditResult {
  const byKind: Record<CatalogIssueKind, number> = {
    known_media_mismatch: 0,
    missing_thumbnail: 0,
    invalid_retail_price: 0,
    placeholder_stock: 0,
    unnamed_variation: 0,
    empty_native_description: 0,
  };
  const copy: Record<CopyStatus, number> = { native: 0, fallback: 0, none: 0, unknown: 0 };
  const rows: CatalogIssueRow[] = [];
  for (const p of products) {
    const copyStatus = copyStatusOf(p, opts);
    copy[copyStatus] += 1;
    const issues = issuesOf(p, opts);
    if (issues.length === 0) continue;
    for (const i of issues) byKind[i.kind] += 1;
    rows.push({
      slug: p.slug,
      name: p.name,
      ...(p.id === undefined ? null : { id: p.id }),
      ...(p.pancakeId === undefined ? null : { pancakeId: p.pancakeId }),
      ...(p.isActive === undefined ? null : { isActive: p.isActive }),
      ...(p.inStock === undefined ? null : { inStock: p.inStock }),
      copyStatus,
      issues,
    });
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
    summary: { total: products.length, flagged: rows.length, flaggedInStock: rows.filter((r) => r.inStock !== false).length, byKind, copy },
    rows,
  };
}

/** Kiểm trực tiếp dữ liệu máy chủ trả cho web (`GET /admin/catalog-quality/audit`): mô tả là chuỗi gốc của DB, có biến thể nên xét đủ sáu loại lỗi. */
export function auditProductDtos(products: readonly CatalogAuditProductDto[], opts: CatalogAuditOptions = {}): CatalogAuditResult {
  return auditCatalogProducts(
    products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      pancakeId: p.pancakeId,
      isActive: p.isActive,
      thumbnail: p.thumbnail,
      description: p.description,
      inStock: p.inStock,
      variations: p.variations,
    })),
    opts,
  );
}
