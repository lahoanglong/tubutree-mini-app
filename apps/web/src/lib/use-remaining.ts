'use client';

import { useEffect, useState } from 'react';
import { serverNow } from '@tubutree/app-core/server-clock';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TICK_MS = 15_000;

/** "Còn 2 giờ 15 phút" / "Còn dưới 1 phút" / "Đã quá hạn": chữ đọc được, không phải "2h 15m". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Đã quá hạn';
  if (ms < MIN) return 'Còn dưới 1 phút';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MIN);
  // Từ một ngày trở lên, số phút không còn ý nghĩa với người đọc.
  const parts = days > 0 ? [`${days} ngày`, hours > 0 && `${hours} giờ`] : [hours > 0 && `${hours} giờ`, minutes > 0 && `${minutes} phút`];
  return `Còn ${parts.filter(Boolean).join(' ')}`;
}

export interface Remaining {
  text: string;
  expired: boolean;
}

/** Thời gian còn lại tới `target` (ISO/Date), cập nhật mỗi 15 giây. Không có hạn hoặc hạn hỏng → text rỗng, expired false. */
export function useRemaining(target: Date | string | null | undefined): Remaining {
  const key = target instanceof Date ? target.getTime() : target;
  const compute = (): Remaining => {
    if (target == null) return { text: '', expired: false };
    const ms = new Date(target).getTime() - serverNow();
    if (Number.isNaN(ms)) return { text: '', expired: false };
    return { text: formatRemaining(ms), expired: ms <= 0 };
  };
  const [state, setState] = useState(compute);
  useEffect(() => {
    setState(compute());
    const id = setInterval(() => setState(compute()), TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` là dạng so sánh được của `target` (Date mới mỗi lần render không làm chạy lại)
  }, [key]);
  return state;
}
