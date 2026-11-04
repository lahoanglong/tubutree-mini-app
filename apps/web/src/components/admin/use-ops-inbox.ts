'use client';

import { useQuery } from '@tanstack/react-query';
import { getOpsInbox, OPS_INBOX_QUERY_KEY } from '@/lib/admin-client';

const INBOX_POLL_MS = 60_000;

/**
 * Hộp việc cần xử lý (một khoá chung cho thẻ Hôm nay, huy hiệu menu và các số trên chip). Mọi nơi đọc dùng chung một truy vấn; chỉ
 * `OpsInboxPoller` (đặt ở trang admin) truyền `poll` để giữ nhịp một phút. Nơi khác tự đặt refetchInterval thì mount lệch nhau
 * sẽ gọi mạng lệch nhịp, nhiều lần hơn cần thiết.
 */
export function useOpsInbox({ enabled = true, poll = false, retry }: { enabled?: boolean; poll?: boolean; retry?: false } = {}) {
  return useQuery({ queryKey: OPS_INBOX_QUERY_KEY, queryFn: getOpsInbox, enabled, ...(retry === undefined ? {} : { retry }), refetchInterval: poll ? INBOX_POLL_MS : false });
}

/** Observer giữ nhịp cho hộp việc, tách thành component lá không trả gì: kết quả truy vấn không đi vào trang nên mỗi lượt poll không dựng lại cả cây admin. */
export function OpsInboxPoller({ enabled }: { enabled: boolean }) {
  useOpsInbox({ enabled, poll: true });
  return null;
}
