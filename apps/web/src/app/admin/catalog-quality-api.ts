import type { AdvisorStatsDto, CatalogAuditResponse, CopyApproveItem, CopyApproveResponse, CopyDraftsResponse, IngredientsFromImageResponse, IngredientsSaveResponse } from '@tubutree/shared-types';
import { apiFetch } from '@/lib/client-api';

/** AI soạn cả lô có thể mất gần một phút ở máy chủ: nới hạn chờ mặc định (20 giây) để web không báo mất mạng trong lúc máy chủ còn đang soạn. */
export const COPY_DRAFT_TIMEOUT_MS = 90_000;

// Dữ liệu sau khi lưu phải là bản mới nhất, nên không cho trình duyệt dùng lại bản đã nhớ.
export const getCatalogAudit = () => apiFetch<CatalogAuditResponse>('/admin/catalog-quality/audit', { cache: 'no-store' });

export const postCopyDrafts = (ids: readonly string[]) =>
  apiFetch<CopyDraftsResponse>('/admin/catalog-quality/copy-drafts', { method: 'POST', body: { ids }, timeoutMs: COPY_DRAFT_TIMEOUT_MS });

export const postCopyApprove = (items: readonly CopyApproveItem[]) =>
  apiFetch<CopyApproveResponse>('/admin/catalog-quality/copy-approve', { method: 'POST', body: { items } });

/** AI đọc nhãn mất tới ~40 giây ở máy chủ (OCR_TIMEOUT_MS): nới hạn chờ mặc định để web không báo mất mạng trong lúc máy chủ còn đọc. */
export const INGREDIENT_OCR_TIMEOUT_MS = 60_000;

const catalogQuality = (id: string) => `/admin/catalog-quality/${encodeURIComponent(id)}`;

/** Bản nháp tên thành phần đọc từ ảnh nhãn (không ghi DB). `image` là data URL JPEG/PNG/WebP ≤ 5 MB. */
export const postExtractIngredients = (id: string, image: string) =>
  apiFetch<IngredientsFromImageResponse>(`${catalogQuality(id)}/extract-ingredients`, { method: 'POST', body: { image }, timeoutMs: INGREDIENT_OCR_TIMEOUT_MS });

/** Lưu thành phần admin đã xem: máy chủ chỉ nối tên mới vào cột thành phần. */
export const postSaveIngredients = (id: string, ingredients: readonly string[]) =>
  apiFetch<IngredientsSaveResponse>(`${catalogQuality(id)}/ingredients`, { method: 'POST', body: { ingredients } });

/**
 * Gắn ảnh cho sản phẩm CHƯA CÓ ảnh (PATCH admin/catalog-products/:id): `images` thay cả danh sách, ảnh đầu là ảnh đại diện. `ifImagesEmpty` làm máy chủ
 * trả 409 thay vì ghi đè khi danh sách đang xem đã cũ và người khác vừa thêm ảnh.
 */
export const setProductImages = (id: string, images: readonly string[]) =>
  apiFetch<unknown>(`/admin/catalog-products/${encodeURIComponent(id)}`, { method: 'PATCH', body: { images, ifImagesEmpty: true } });

export const getAdvisorStats = () => apiFetch<AdvisorStatsDto>('/admin/ai-advisor/stats', { cache: 'no-store' });

export type PancakeZeroPriceKind = 'PRICE_KEPT' | 'NEW_AT_ZERO';

/** Dạng của `GET /admin/catalog-quality/pancake-zero-price` (apps/api: ZeroPriceSummary). */
export interface PancakeZeroPriceDto {
  scope: 'FULL' | 'INCREMENTAL';
  updatedAt: string;
  count: number;
  keptCount: number;
  newCount: number;
  skus: Array<{ pancakeId: string; sku: string; productName: string; kind: PancakeZeroPriceKind; keptPrice: number | null }>;
  truncated: boolean;
}

export const getPancakeZeroPrice = () => apiFetch<PancakeZeroPriceDto>('/admin/catalog-quality/pancake-zero-price', { cache: 'no-store' });

/**
 * Tải chuỗi CSV về máy. `buildPancakeFixCsv` đã tự thêm BOM UTF-8 nên KHÔNG dùng `downloadCsvFile` của lib/export-csv.ts
 * (nó thêm BOM lần nữa, Excel hiện ký tự lạ ở ô tiêu đề đầu tiên).
 */
export function downloadCsvText(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Thu hồi chậm một nhịp: một số trình duyệt bắt đầu tải sau lệnh click, thu hồi ngay sẽ được tệp rỗng.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
