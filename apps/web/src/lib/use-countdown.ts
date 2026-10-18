'use client';

import { useEffect, useState } from 'react';

/** "Xh YYm" cho `ms` còn lại, làm tròn LÊN theo phút (phút cuối không hiện "0h 00m" khi chưa hết giờ). Hết giờ → ''. */
export function formatCountdown(ms: number): string {
  if (!(ms > 0)) return '';
  const totalMin = Math.ceil(ms / 60_000);
  return `${Math.floor(totalMin / 60)}h ${(totalMin % 60).toString().padStart(2, '0')}m`;
}

/** Đếm ngược tới `target` (Date hoặc ISO string), cập nhật mỗi 30s. "Xh Ym"; '' nếu target null, không parse được hoặc đã qua. */
export function useCountdown(target: Date | string | null): string {
  const compute = () => {
    if (!target) return '';
    const targetMs = new Date(target).getTime();
    if (Number.isNaN(targetMs)) return ''; // target không parse được (Invalid Date) → tránh "NaNh NaNm"
    return formatCountdown(targetMs - Date.now());
  };
  const [label, setLabel] = useState(compute);
  useEffect(() => {
    setLabel(compute()); // recompute NGAY khi target đổi (chống nhãn rỗng tới 30s)
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
  }, [typeof target === 'string' ? target : target?.getTime()]);
  return label;
}
