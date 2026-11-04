import { MutationCache, QueryClient, type InvalidateOptions, type InvalidateQueryFilters } from '@tanstack/react-query';
import { ME_SUMMARY_KEY, summaryKeyAffectedBy } from '@tubutree/app-core/api/me-summary';
import { CATALOG_STALE_MS } from '@tubutree/app-core/catalog-stale';
import { ApiError } from '@/lib/client-api';

/**
 * Làm mới ['orders'] (đặt đơn, huỷ đơn, thanh toán), ['notifications'] (đọc tin) hay ['subscriptions'] cũng làm cũ các số của
 * /me/summary (huy hiệu thanh đáy, số đơn và tin chưa đọc ở Cá nhân). Gom ở đây để mọi nơi đang gọi invalidateQueries,
 * kể cả trang chưa viết, không phải nhớ khoá summary; query không có người xem chỉ bị đánh dấu cũ, không gọi mạng.
 */
export class TubuQueryClient extends QueryClient {
  private summaryRefresh: Promise<void> | null = null;

  override invalidateQueries(filters?: InvalidateQueryFilters, options?: InvalidateOptions): Promise<void> {
    const own = super.invalidateQueries(filters, options);
    if (!summaryKeyAffectedBy(filters?.queryKey)) return own;
    // Kéo-để-làm-mới làm mới ba gốc khoá liền nhau: gộp theo microtask để chỉ MỘT lời gọi summary, vẫn giữ cancelRefetch mặc định
    // (lần tải cũ đang bay bị huỷ nên không ghi đè số cũ lên số mới). Promise trả về chờ cả summary.
    this.summaryRefresh ??= Promise.resolve().then(() => {
      this.summaryRefresh = null;
      return super.invalidateQueries({ queryKey: ME_SUMMARY_KEY });
    });
    return Promise.all([own, this.summaryRefresh]).then(() => undefined);
  }
}

/** Lỗi 4xx là nghiệp vụ (404, 401...): thử lại vẫn y vậy, chỉ nhân đôi request. Mất mạng và 5xx thì thử một lần. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

const PUBLIC_CONFIG_STALE_MS = 5 * 60_000;

/** Khoá admin ('admin-...') và huy hiệu hoàn tiền: đổi tab qua lại trong 30 giây dùng lại dữ liệu cũ thay vì gọi lại mạng. */
export const ADMIN_STALE_MS = 30_000;
// Hội thoại chat và chấm công trực tiếp là dữ liệu sống (hỏi lại theo nhịp và khi quay lại cửa sổ): luôn coi là cũ.
const LIVE_ADMIN_KEY = /^admin-(support-|attendance-live)/;
function defaultStaleTime(query: { queryKey: readonly unknown[] }): number {
  const head = query.queryKey[0];
  return typeof head === 'string' && head.startsWith('admin-') && !LIVE_ADMIN_KEY.test(head) ? ADMIN_STALE_MS : 0;
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Thao tác không ghi gì (xem trước, tra cứu, xuất file...): xong thì không làm cũ các khoá admin. */
      skipAdminInvalidate?: boolean;
      /** Mutation chỉ làm cũ các khoá admin có tên đầu khớp đúng một trong danh sách này (vd 'admin-users'); không khai thì làm cũ mọi khoá admin. Bị `skipAdminInvalidate` lấn át. */
      adminInvalidate?: readonly string[];
    };
  }
}

const isAdminKey = (query: { queryKey: readonly unknown[] }) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('admin-');

/**
 * QueryClient của web. Mutation `networkMode: 'always'` (như Mini App, R4-BUYER-1): mặc định 'online' TẠM DỪNG mutation khi
 * trình duyệt báo offline rồi tự chạy khi có mạng lại — bấm "Đặt hàng" lúc mất mạng thì nút treo "Đang đặt hàng…", và đơn tự
 * được tạo sau đó kể cả khi khách đã rời trang. 'always' gửi request thật, lỗi mạng rơi vào onError (hiện câu "Mất kết nối…"),
 * không có hàng đợi nào chạy lại về sau. Query: khoá admin có staleTime riêng (defaultStaleTime), khoá khác giữ mặc định.
 */
export function createQueryClient(): QueryClient {
  // Mutation nào xong (thành công hay lỗi) cũng làm cũ mọi khoá admin: nhiều mutation chỉ làm mới khoá của mình, mà màn khác
  // (Người dùng, hộp việc, số trên chip...) đọc cùng dữ liệu. staleTime 30 giây chỉ để đổi tab không gọi lại mạng.
  const mutationCache = new MutationCache({
    onSettled: (_data, _error, _variables, _context, mutation) => {
      const { skipAdminInvalidate, adminInvalidate } = mutation.meta ?? {};
      if (skipAdminInvalidate) return;
      const only = adminInvalidate ? new Set(adminInvalidate) : null;
      void client.invalidateQueries({ predicate: (q) => isAdminKey(q) && (!only || only.has(q.queryKey[0] as string)) });
    },
  });
  const client: QueryClient = new TubuQueryClient({
    mutationCache,
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false, staleTime: defaultStaleTime },
      mutations: { networkMode: 'always' },
    },
  });
  // Danh mục sản phẩm đổi chậm (đồng bộ Pancake ~15 phút): quay lại trong 60 giây thì dùng lại, không gọi mạng.
  client.setQueryDefaults(['products'], { staleTime: CATALOG_STALE_MS });
  client.setQueryDefaults(['storefront-categories'], { staleTime: CATALOG_STALE_MS });
  // Cấu hình công khai (/config/public) có nhiều trang cùng đọc; trang nào không tự đặt staleTime thì mount lại là gọi thêm một lần.
  client.setQueryDefaults(['public-config'], { staleTime: PUBLIC_CONFIG_STALE_MS });
  return client;
}
