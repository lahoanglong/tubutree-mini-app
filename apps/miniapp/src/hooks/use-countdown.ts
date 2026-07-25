import { useEffect, useState } from 'react';

/** Đếm ngược tới `target` (Date hoặc ISO string), cập nhật mỗi 30s. "Xh Ym"; '' nếu target null. */
export function useCountdown(target: Date | string | null): string {
  const compute = () => {
    if (!target) return '';
    const ms = Math.max(0, new Date(target).getTime() - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };
  const [label, setLabel] = useState(compute);
  useEffect(() => {
    setLabel(compute()); // recompute NGAY khi target đổi (chống nhãn rỗng tới 30s)
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
  }, [typeof target === 'string' ? target : target?.getTime()]);
  return label;
}
