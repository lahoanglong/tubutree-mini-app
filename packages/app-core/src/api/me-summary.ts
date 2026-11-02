import type { MeSummaryDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export type { MeSummaryDTO };

/**
 * MỘT khoá cho mọi số đếm của Cá nhân và thanh đáy. Nằm dưới ['me'] nên mọi `invalidateQueries({ queryKey: ['me'] })` làm mới nó;
 * đặt đơn/huỷ đơn (['orders']), đọc tin (['notifications']) và gói định kỳ (['subscriptions']) làm mới qua `summaryKeyAffectedBy`.
 */
export const ME_SUMMARY_KEY = ['me', 'summary'] as const;

/** Gốc khoá mà khi bị làm mới thì các số trong summary cũng cũ (['me'] đã phủ sẵn bằng tiền tố). */
const SUMMARY_ROOTS: ReadonlySet<unknown> = new Set(['orders', 'notifications', 'subscriptions']);

export const summaryKeyAffectedBy = (queryKey: readonly unknown[] | undefined): boolean => queryKey !== undefined && SUMMARY_ROOTS.has(queryKey[0]);

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Body lạ (route khác trả nhầm, API cũ) thì ném lỗi: query lỗi và màn không hiện số, thay vì hiện 0 hay NaN. */
export function parseMeSummary(body: unknown): MeSummaryDTO {
  const b = body as Partial<MeSummaryDTO> | null | undefined;
  const o = b?.orders;
  if (
    !o ||
    !isCount(o.pending_payment) ||
    !isCount(o.processing) ||
    !isCount(o.shipping) ||
    !isCount(o.delivered) ||
    !isCount(o.closed) ||
    !isCount(o.active) ||
    !isCount(b?.unreadNotifications) ||
    !isCount(b?.activeSubscriptions)
  ) {
    throw new Error('Phản hồi /me/summary không đúng dạng');
  }
  return { orders: { ...o }, unreadNotifications: b.unreadNotifications, activeSubscriptions: b.activeSubscriptions };
}

export const getMeSummary = async (http: HttpClient): Promise<MeSummaryDTO> => parseMeSummary(await http.get<unknown>('/me/summary'));

export const meSummaryQuery = (http: HttpClient) => ({
  queryKey: ME_SUMMARY_KEY,
  queryFn: () => getMeSummary(http),
});
