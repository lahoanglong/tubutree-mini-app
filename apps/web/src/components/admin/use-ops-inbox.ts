'use client';

import { useQuery } from '@tanstack/react-query';
import { getOpsInbox, OPS_INBOX_QUERY_KEY } from '@/lib/admin-client';

const INBOX_POLL_MS = 60_000;

/**
 * Hộp việc cần xử lý (một khoá chung cho thẻ Hôm nay, huy hiệu menu, số trên chip). Mọi nơi đọc dùng chung một truy vấn; chỉ MỘT nơi
 * truyền `poll` (trang admin) để giữ nhịp một phút — mỗi observer có refetchInterval riêng thì các nơi mount lệch nhau gọi mạng lệch
 * nhịp, nhiều lần hơn cần thiết.
 */
export function useOpsInbox({ enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({ queryKey: OPS_INBOX_QUERY_KEY, queryFn: getOpsInbox, enabled, refetchInterval: poll ? INBOX_POLL_MS : false });
}
