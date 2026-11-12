/**
 * Hợp đồng API của bàn làm việc chất lượng catalog (W126) và thống kê AI tư vấn (W127). Chỉ kiểu và hằng; logic ở API và app-core.
 *
 * - `GET  /admin/catalog-quality/audit`       → `CatalogAuditResponse` (ADMIN; mọi sản phẩm kể cả đang ẩn, kèm biến thể)
 * - `POST /admin/catalog-quality/copy-drafts` body `{ ids }` (1..`COPY_DRAFT_MAX_BATCH`) → `CopyDraftsResponse` (ADMIN; không ghi DB)
 * - `POST /admin/catalog-quality/copy-approve` body `{ items }` (1..`COPY_DRAFT_MAX_BATCH`) → `CopyApproveResponse` (ADMIN; ghi DB sau khi lọc lại phía máy chủ)
 * - `GET  /admin/ai-advisor/stats`            → `AdvisorStatsDto` (ADMIN; bộ đếm trong bộ nhớ của instance API)
 */
export const COPY_DRAFT_MAX_BATCH = 10;

export interface CatalogAuditVariationDto {
  id: string;
  pancakeId: string | null;
  sku: string;
  name: string;
  stock: number;
  retailPrice: number;
  isActive: boolean;
}

export interface CatalogAuditProductDto {
  id: string;
  slug: string;
  name: string;
  pancakeId: string | null;
  isActive: boolean;
  thumbnail: string | null;
  /** Mô tả gốc trong DB (chưa bù chữ dự phòng). */
  description: string;
  shortDesc: string | null;
  /** `ingredients` trong DB có ít nhất một tên thật. */
  hasIngredients: boolean;
  /** Còn ít nhất một biến thể đang bán và còn hàng (cùng nghĩa với `inStock` của danh sách công khai). */
  inStock: boolean;
  variations: CatalogAuditVariationDto[];
}

export interface CatalogAuditResponse {
  products: CatalogAuditProductDto[];
  /** `true` nếu catalog vượt trần đọc của máy chủ và danh sách đã bị cắt. */
  truncated: boolean;
}

export type CopyDraftSource = 'ai' | 'fallback';

export interface CopyDraft {
  id: string;
  slug: string;
  name: string;
  shortDesc: string;
  description: string;
  /** Chỉ tên thành phần; lưu vào DB thành `[{ name }]`. */
  ingredients: string[];
  /** `ai`: model soạn; `fallback`: chữ dự phòng đã duyệt trong `@tubutree/shared-types` (AI chưa cấu hình, lỗi, hoặc mọi câu bị bộ chặn bỏ). */
  source: CopyDraftSource;
  /** Câu/thành phần bị bộ chặn tuyên bố bỏ, và lý do khác (vd "AI lỗi, dùng chữ dự phòng"), tiếng Việt, để admin đọc. */
  warnings: string[];
}

export interface CopyDraftsResponse {
  drafts: CopyDraft[];
  /** Sản phẩm không soạn được (không thấy, của đối tác, không có chữ dự phòng khi AI không dùng được...). */
  failed: { id: string; reason: string }[];
}

export interface CopyApproveItem {
  id: string;
  shortDesc: string;
  description: string;
  ingredients: string[];
}

export interface CopyApproveResponse {
  saved: string[];
  /** Bị chặn: còn tuyên bố cấm sau khi lọc lại, nội dung rỗng, hay sản phẩm của đối tác/không tồn tại. */
  rejected: { id: string; reasons: string[] }[];
}

export interface AdvisorStatsDto {
  /** ISO: lúc API khởi động; bộ đếm tính từ đây (khởi động lại là về 0). */
  since: string;
  /** Lượt hỏi hợp lệ đã xử lý (không tính lượt bị từ chối vì câu hỏi rỗng). */
  total: number;
  /** Lượt LLM trả lời. */
  ok: number;
  /** Lượt trả lời dự phòng: LLM lỗi/chậm/bận, đã chạm trần hỏi, hay chưa cấu hình. */
  fallback: number;
  /** p95 thời gian một lượt `chat` (mili giây) trên các mẫu gần nhất; `null` nếu chưa có mẫu. */
  latencyP95Ms: number | null;
  latencySamples: number;
  /** Sản phẩm được gợi ý nhiều nhất (cùng một lượt chỉ tính một lần mỗi sản phẩm). Không có dữ liệu bấm: chỉ đo số lần gợi ý. */
  topSkus: { slug: string; name: string; count: number }[];
}
