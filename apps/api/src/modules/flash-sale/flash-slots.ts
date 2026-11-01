import type { Prisma } from '@prisma/client';

export type FlashSlotStatus = 'LIVE' | 'UPCOMING' | 'ENDED';

/** Giờ VN là UTC+7 quanh năm (không có giờ mùa hè), nên cộng/trừ hằng số là đủ. */
const VN_OFFSET_MS = 7 * 3600e3;
const DAY_MS = 24 * 3600e3;

export function slotStatus(s: { startAt: Date; endAt: Date }, now: Date): FlashSlotStatus {
  const t = now.getTime();
  if (t >= s.endAt.getTime()) return 'ENDED';
  return t >= s.startAt.getTime() ? 'LIVE' : 'UPCOMING';
}

/** 00:00 giờ VN của ngày chứa `now`. */
export function vnDayStart(now: Date): Date {
  const vn = now.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(vn / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}

/** 00:00 giờ VN của ngày kia: hết hôm nay và ngày mai. */
export function vnHorizonEnd(now: Date): Date {
  return new Date(vnDayStart(now).getTime() + 2 * DAY_MS);
}

/** Thứ tự cố định của suất trong một khung: chủ shop ghim bằng sortOrder, còn lại rẻ trước, id chốt thứ tự giữa hai lần gọi. */
export const SLOT_ITEM_ORDER_BY = [{ sortOrder: 'asc' }, { flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }] satisfies Prisma.FlashSaleItemOrderByWithRelationInput[];
