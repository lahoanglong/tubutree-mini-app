import type { Prisma } from '@prisma/client';

/** Tin khách chưa chuyển quá ngần này, hoặc cầu nối không CONNECTED quá ngần này, thì coi là sự cố cần người xem. */
export const STALE_AFTER_MS = 10 * 60_000;
/** Forward PENDING chưa có zaloMsgId mà không đổi trạng thái quá ngần này là bị bỏ dở. */
export const STALE_PENDING_MS = 10 * 60_000;

/** Cầu nối chống đăng đôi theo forward.id trong 24 giờ: quá 20 giờ thì không tự gửi lại, chỉ admin gửi lại tay. */
export const STALE_PENDING_AUTO_MAX_MS = 20 * 3_600_000;

/** Stale PENDING còn trong hạn tự nhặt lại (sweep, bộ xử lý). */
export function resumablePendingForwardWhere(now: Date): Prisma.SupportForwardWhereInput {
  return { status: 'PENDING', zaloMsgId: null, updatedAt: { lt: new Date(now.getTime() - STALE_PENDING_MS), gte: new Date(now.getTime() - STALE_PENDING_AUTO_MAX_MS) } };
}

/** Mã lỗi chứng tỏ cầu nối chưa đăng gì lên nhóm: gửi lại tự động an toàn. SEND_FAILED và UNKNOWN thì không (có thể đã đăng). */
export const TRANSIENT_FAILURE_CODES = ['NOT_CONNECTED', 'NO_GROUP', 'NETWORK', 'BRIDGE_NOT_CONFIGURED'] as const;

/** `lastError` được ghi dạng `MÃ: lời nhắn` (forward-delivery) nên mã nằm ở đầu chuỗi. */
export function resumableFailedForwardWhere(now: Date): Prisma.SupportForwardWhereInput {
  return {
    status: 'FAILED',
    zaloMsgId: null,
    createdAt: { gte: new Date(now.getTime() - STALE_PENDING_AUTO_MAX_MS) },
    conversation: { blockedAt: null },
    OR: TRANSIENT_FAILURE_CODES.map((c) => ({ lastError: { startsWith: `${c}:` } })),
  };
}

export function stalePendingForwardWhere(now: Date): Prisma.SupportForwardWhereInput {
  return { status: 'PENDING', zaloMsgId: null, updatedAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } };
}

/** Cùng điều kiện với stalePendingForwardWhere, cho dữ liệu đã nạp trong bộ nhớ. */
export function isStalePendingForward(f: { status: string; zaloMsgId: string | null; updatedAt: Date }, now: Date): boolean {
  return f.status === 'PENDING' && f.zaloMsgId === null && f.updatedAt.getTime() < now.getTime() - STALE_PENDING_MS;
}

export function unforwardedMessageWhere(now: Date): Prisma.SupportMessageWhereInput {
  return { sender: 'CUSTOMER', forwardId: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } };
}

/**
 * Hội thoại chưa bị chặn có lần chuyển hỏng/không rõ kết quả/bị bỏ dở, hoặc tin khách chờ chuyển quá lâu.
 * Dùng chung cho bộ lọc admin, cờ từng dòng và ops inbox để số khớp dòng. Hội thoại bị chặn không còn được chuyển nên không tính.
 */
export function unforwardedWhere(now: Date): Prisma.SupportConversationWhereInput {
  return {
    blockedAt: null,
    OR: [
      { forwards: { some: { status: { in: ['FAILED', 'UNKNOWN'] } } } },
      { forwards: { some: stalePendingForwardWhere(now) } },
      { messages: { some: unforwardedMessageWhere(now) } },
    ],
  };
}

export function bridgeIsDown(row: { state: string; since: Date } | null, now: Date): boolean {
  return !!row && row.state !== 'CONNECTED' && now.getTime() - row.since.getTime() > STALE_AFTER_MS;
}
