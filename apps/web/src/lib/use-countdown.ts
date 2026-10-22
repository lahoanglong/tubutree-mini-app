'use client';

import { useEffect, useState } from 'react';
import { serverNow } from '@tubutree/app-core/server-clock';

/** "Xh YYm" cho `ms` còn lại, làm tròn LÊN theo phút (phút cuối không hiện "0h 00m" khi chưa hết giờ). Hết giờ → ''. */
export function formatCountdown(ms: number): string {
  if (!(ms > 0)) return '';
  const totalMin = Math.ceil(ms / 60_000);
  return `${Math.floor(totalMin / 60)}h ${(totalMin % 60).toString().padStart(2, '0')}m`;
}

const read = (targetMs: number) => (Number.isNaN(targetMs) ? '' : formatCountdown(targetMs - serverNow()));

/** Đếm ngược tới `target` (Date hoặc ISO string), cập nhật mỗi 30s. "Xh Ym"; '' nếu target null, không parse được hoặc đã qua. */
export function useCountdown(target: Date | string | null): string {
  // Không parse được (Invalid Date) → NaN → rỗng, tránh "NaNh NaNm".
  const targetMs = target ? new Date(target).getTime() : Number.NaN;
  const [label, setLabel] = useState(() => read(targetMs));
  useEffect(() => {
    setLabel(read(targetMs)); // recompute NGAY khi target đổi (chống nhãn rỗng tới 30s)
    const id = setInterval(() => setLabel(read(targetMs)), 30_000);
    return () => clearInterval(id);
  }, [targetMs]);
  return label;
}
