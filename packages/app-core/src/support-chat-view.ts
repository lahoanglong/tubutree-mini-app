import type { SupportChatMessageDTO } from '@tubutree/shared-types';

export const byTime = (a: SupportChatMessageDTO, b: SupportChatMessageDTO) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * API không gửi tin nhân viên đã thu hồi, nên tin nào nằm từ đầu cửa sổ poll trở đi mà không còn trong cửa sổ là đã bị thu hồi.
 * Tin chỉ có ở trang cũ thì giữ nguyên (thu hồi ở đó sẽ hiện sau khi mở lại màn).
 * Cửa sổ đã phủ hết hội thoại (`hasMore` false) thì kho chỉ còn đúng tin của cửa sổ.
 */
export function mergeWindow(prev: ReadonlyMap<string, SupportChatMessageDTO>, windowMsgs: readonly SupportChatMessageDTO[], hasMore: boolean) {
  if (!hasMore) return new Map(windowMsgs.map((m) => [m.id, m]));
  const next = new Map(prev);
  const first = [...windowMsgs].sort(byTime)[0];
  if (first) for (const m of prev.values()) if (byTime(m, first) >= 0) next.delete(m.id);
  for (const m of windowMsgs) next.set(m.id, m);
  return next;
}

export type SendFailureKind = 'rate-limited' | 'rejected' | 'failed';

/**
 * 429 vẫn cho gửi lại (đợi vài giây là hết) trừ trần tin trong ngày, đợi cũng vô ích; 4xx khác máy chủ đã từ chối nên gửi lại cũng vậy;
 * mạng chập chờn và 5xx thì gửi lại được.
 */
export function sendFailureKind(status: number | undefined, code?: string | null): SendFailureKind {
  if (status === 429) return code === 'CHAT_DAILY_LIMIT' ? 'rejected' : 'rate-limited';
  if (status !== undefined && status >= 400 && status < 500) return 'rejected';
  return 'failed';
}
