import { useEffect, useState } from 'react';
import { countdownText } from '@tubutree/app-core/commerce/countdown';
import { serverNow } from '../utils/server-clock';

/** Đếm ngược tới `target` (Date hoặc ISO string), cập nhật mỗi 30s. "2 giờ 05 phút" (`countdownText`); '' nếu target null, không parse được hoặc đã qua. */
export function useCountdown(target: Date | string | null): string {
  const compute = () => {
    if (!target) return '';
    const targetMs = new Date(target).getTime();
    if (Number.isNaN(targetMs)) return ''; // target không parse được (Invalid Date) → tránh chữ rác
    return countdownText(targetMs - serverNow());
  };
  const [label, setLabel] = useState(compute);
  useEffect(() => {
    setLabel(compute()); // recompute NGAY khi target đổi (chống nhãn rỗng tới 30s)
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
  }, [typeof target === 'string' ? target : target?.getTime()]);
  return label;
}
