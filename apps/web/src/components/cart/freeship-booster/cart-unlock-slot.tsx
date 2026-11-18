'use client';

// Nguồn: apps/miniapp/src/components/cart/freeship-booster/cart-unlock-slot.tsx (cùng luật mừng, cùng lớp CSS `tubu-unlock`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UNLOCK_CELEBRATE_MS, shouldCelebrateUnlock } from '@tubutree/app-core/commerce/freeship-progress';

/**
 * Bật trong `UNLOCK_CELEBRATE_MS` mỗi khi `level` vượt mức cao nhất đã thấy trong lần mở giỏ này (`shouldCelebrateUnlock`). Lần vẽ đầu không bật: giỏ mở ra đã
 * đạt sẵn thì không có gì để mừng. Mức tụt rồi lên lại (bỏ chọn một món) không bật lần hai.
 */
export function useUnlockCelebration(level: number): boolean {
  const highest = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const prev = highest.current;
    highest.current = prev === null ? level : Math.max(prev, level);
    if (!shouldCelebrateUnlock(prev, level)) return;
    setActive(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(false), UNLOCK_CELEBRATE_MS);
  }, [level]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return active;
}

/**
 * Khung của dải tiến độ đầu Giỏ (Miễn phí giao hàng, hoặc Hộp Xanh khi đã đạt). `level` là `cartUnlockLevel(...)`: khách vừa đạt Miễn phí giao hàng hay lên bậc Hộp Xanh
 * thì dải con trực tiếp `.tubu-freeship` nảy nhẹ một lần và toả vòng sáng màu thành công (mini.css, tắt khi giảm chuyển động). Khung không thêm lề hay nền.
 */
export function CartUnlockSlot({ level, className, testId = 'cart-unlock', children }: { level: number; className?: string; testId?: string; children: ReactNode }) {
  const celebrate = useUnlockCelebration(level);
  return (
    <div data-testid={testId} data-celebrate={celebrate ? 'true' : undefined} className={className ? `tubu-unlock ${className}` : 'tubu-unlock'}>
      {children}
    </div>
  );
}
