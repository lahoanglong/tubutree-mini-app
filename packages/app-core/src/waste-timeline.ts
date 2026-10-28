import type { WasteMethod, WasteRequestStatus } from '@tubutree/shared-types';

/** Dòng tiến độ 4 bước của một yêu cầu đổi rác, dùng chung cho Mini App và web. */
export const TIMELINE_STEPS: Record<WasteMethod, readonly string[]> = {
  MAIL_IN: ['Gửi kiện', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm'],
  DROP_OFF: ['Đã tạo', 'Mang tới điểm', 'Điểm nhận đếm', 'Cộng điểm'],
  PICKUP: ['Đã tạo', 'Gắn vào đơn', 'Kho nhận, đếm', 'Cộng điểm'],
};

export type WasteTimeline = { steps: readonly string[]; current: number };

const CLOSED_STATUSES: readonly WasteRequestStatus[] = ['REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED'];

/** `current` là chỉ số bước đang diễn ra; bằng số bước nghĩa là xong hết. Yêu cầu đã đóng không có tiến độ (null). */
export function timelineFor(r: { method: WasteMethod; status: WasteRequestStatus; orderCode: string | null }): WasteTimeline | null {
  if (CLOSED_STATUSES.includes(r.status)) return null;
  const steps = TIMELINE_STEPS[r.method];
  if (r.status === 'COMPLETED') return { steps, current: 4 };
  if (r.method === 'MAIL_IN') {
    return { steps, current: r.status === 'IN_TRANSIT' ? 1 : r.status === 'RECEIVED' ? 2 : 0 };
  }
  if (r.method === 'DROP_OFF') return { steps, current: r.status === 'OPEN' ? 1 : 2 };
  // Thu kèm đơn: kho nhận xong (RECEIVED) là đang đếm, bước 3.
  if (r.status === 'RECEIVED') return { steps, current: 3 };
  return { steps, current: r.status === 'OPEN' && !r.orderCode ? 1 : 2 };
}
