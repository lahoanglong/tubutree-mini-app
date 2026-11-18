'use client';

import { startTransition, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Đặt lần đầu một khối đã hydrate xong. Server không chạy effect nên ở server luôn `false`: HTML đầu và lần hydrate đầu đều là khung giữ chỗ.
let hydrated = false;

/** Khoảng trước khung nhìn mà khối bắt đầu dựng (một rưỡi chiều cao khung nhìn): đủ để lưới có dữ liệu và ảnh trước khi khách cuộn tới. */
export const DEFER_ROOT_MARGIN = '150% 0%';

export interface DeferUntilNearProps {
  children: ReactNode;
  /** Kích thước khung giữ chỗ: phải cao đúng chiều cao khối thật ở từng bề ngang để khi khối hiện, phần bên dưới không nhảy. */
  placeholderStyle: CSSProperties;
  /** Lớp thêm cho khung giữ chỗ (vd đổi chiều cao theo bề ngang qua biến CSS đặt ở `placeholderStyle`). */
  placeholderClassName?: string;
}

/**
 * Khối dưới màn đầu của Trang chủ không nằm trong HTML server: HTML đầu và lần hydrate chỉ có một khung giữ chỗ đúng kích thước, khối thật dựng khi
 * khung đó gần tới khung nhìn (`DEFER_ROOT_MARGIN`). Lần dựng đó là transition nên không thành một tác vụ dài chặn thao tác của khách.
 * Trang chủ mở lại bằng điều hướng trong app (đã hydrate rồi) thì dựng ngay, để khôi phục vị trí cuộn vẫn tới được nội dung cũ.
 */
export function DeferUntilNear({ children, placeholderStyle, placeholderClassName }: DeferUntilNearProps) {
  const [shown, setShown] = useState(() => hydrated);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hydrated = true;
  }, []);
  useEffect(() => {
    if (shown) return;
    const reveal = () => startTransition(() => setShown(true));
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      reveal();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          reveal();
        }
      },
      { rootMargin: DEFER_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  if (shown) return <>{children}</>;
  return <div ref={ref} aria-hidden data-testid="home-defer" className={placeholderClassName} style={placeholderStyle} />;
}

/** Chỉ cho test: về lại trạng thái chưa hydrate. */
export function __resetDeferForTest() {
  hydrated = false;
}
