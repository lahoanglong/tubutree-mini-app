import type { AdvisorStatsDto, CatalogAuditResponse, CopyApproveItem, CopyApproveResponse, CopyDraftsResponse } from '@tubutree/shared-types';
import { apiFetch } from '@/lib/client-api';

/** AI soạn cả lô có thể mất gần một phút ở máy chủ: nới hạn chờ mặc định (20 giây) để web không báo mất mạng trong lúc máy chủ còn đang soạn. */
export const COPY_DRAFT_TIMEOUT_MS = 90_000;

// Dữ liệu sau khi lưu phải là bản mới nhất, nên không cho trình duyệt dùng lại bản đã nhớ.
export const getCatalogAudit = () => apiFetch<CatalogAuditResponse>('/admin/catalog-quality/audit', { cache: 'no-store' });

export const postCopyDrafts = (ids: readonly string[]) =>
  apiFetch<CopyDraftsResponse>('/admin/catalog-quality/copy-drafts', { method: 'POST', body: { ids }, timeoutMs: COPY_DRAFT_TIMEOUT_MS });

export const postCopyApprove = (items: readonly CopyApproveItem[]) =>
  apiFetch<CopyApproveResponse>('/admin/catalog-quality/copy-approve', { method: 'POST', body: { items } });

export const getAdvisorStats = () => apiFetch<AdvisorStatsDto>('/admin/ai-advisor/stats', { cache: 'no-store' });

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
