import type { Prisma } from '@prisma/client';

/** Tin khách chưa chuyển quá ngần này, hoặc cầu nối không CONNECTED quá ngần này, thì coi là sự cố cần người xem. */
export const STALE_AFTER_MS = 10 * 60_000;

/** Hội thoại có lần chuyển hỏng/không rõ kết quả, hoặc tin khách chờ chuyển quá lâu. Dùng chung cho bộ lọc admin và ops inbox để số khớp dòng. */
export function unforwardedWhere(now: Date): Prisma.SupportConversationWhereInput {
  return {
    OR: [
      { forwards: { some: { status: { in: ['FAILED', 'UNKNOWN'] } } } },
      { messages: { some: { sender: 'CUSTOMER', forwardId: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } } },
    ],
  };
}

export function bridgeIsDown(row: { state: string; since: Date } | null, now: Date): boolean {
  return !!row && row.state !== 'CONNECTED' && now.getTime() - row.since.getTime() > STALE_AFTER_MS;
}
