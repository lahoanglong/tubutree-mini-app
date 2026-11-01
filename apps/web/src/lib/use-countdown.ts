'use client';

import { useEffect, useState } from 'react';
import { countdownText } from '@tubutree/app-core/commerce/countdown';
import { serverNow } from '@tubutree/app-core/server-clock';

const read = (targetMs: number) => (Number.isNaN(targetMs) ? '' : countdownText(targetMs - serverNow()));

/** Đếm ngược tới `target` (Date hoặc ISO string), cập nhật mỗi 30s. "2 giờ 05 phút" (`countdownText`); '' nếu target null, không parse được hoặc đã qua. */
export function useCountdown(target: Date | string | null): string {
  // Không parse được (Invalid Date) → NaN → rỗng, tránh chữ rác.
  const targetMs = target ? new Date(target).getTime() : Number.NaN;
  const [label, setLabel] = useState(() => read(targetMs));
  useEffect(() => {
    setLabel(read(targetMs)); // recompute NGAY khi target đổi (chống nhãn rỗng tới 30s)
    const id = setInterval(() => setLabel(read(targetMs)), 30_000);
    return () => clearInterval(id);
  }, [targetMs]);
  return label;
}
