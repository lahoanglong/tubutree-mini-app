'use client';

import { useCallback, useState } from 'react';
import type { SpinResult } from '@tubutree/app-core/api/game';

/**
 * Trạng thái hộp kết quả vòng quay, đặt ở cấp trang (xem WheelPrizeSheet). `onResult(null)` là "vừa bắt
 * đầu lượt quay mới" nên đóng kết quả cũ; `onResult(prize)` mở kết quả mới.
 */
export function useWheelPrize() {
  const [prize, setPrize] = useState<SpinResult['prize'] | null>(null);
  const [open, setOpen] = useState(false);
  const onResult = useCallback((next: SpinResult['prize'] | null) => {
    if (next) setPrize(next);
    setOpen(next !== null);
  }, []);
  const onClose = useCallback(() => setOpen(false), []);
  return { onResult, sheet: { prize, open, onClose } };
}
