'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface GameNotice {
  id: number;
  text: string;
  tone: 'success' | 'info' | 'error';
}

const SHOW_MS = 4000;

/** Thông báo ngắn thay cho snackbar của Mini App: một thông báo tại một thời điểm, tự tắt sau vài giây. */
export function useGameNotice() {
  const [notice, setNotice] = useState<GameNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const notify = useCallback((text: string, tone: GameNotice['tone']) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setNotice({ id: seq.current, text, tone });
    timer.current = setTimeout(() => setNotice(null), SHOW_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { notice, notify };
}

/**
 * Lỗi dùng role="alert" để đọc ngay; thành công và thông tin (`info`, như snackbar info của Mini App) dùng role="status". Đưa ra body với z-index trên Sheet (z-50): hộp xác
 * nhận được giữ mở khi lỗi (để gửi lại cùng Idempotency-Key) nên thông báo nằm trong trang sẽ bị nó che. Nằm trên thanh
 * điều hướng đáy của điện thoại kể cả khi có vùng an toàn của iPhone. `raised`: trang có thanh nhập dính đáy ở mọi cỡ
 * màn hình (/tu-van) thì giữ thông báo trên thanh đó, không hạ xuống md:bottom-6 vì sẽ đè vào ô nhập. `overSheet`: báo từ trong
 * BottomSheet của design system (z-index 1000, cao hơn Sheet cũ) nên phải nằm trên nó, như snackbar của Mini App nằm trên sheet.
 * `visualOnly`: chỉ để nhìn, trình đọc màn hình không đọc (aria-hidden, không role): vùng live nằm ngoài hộp thoại aria-modal bị nhiều
 * trình đọc bỏ qua và vùng chèn sẵn chữ thường không được đọc, nên nơi gọi giữ một vùng live trống cố định trong hộp thoại và đọc câu ở đó.
 */
export function GameNoticeBar({
  notice,
  raised = false,
  overSheet = false,
  visualOnly = false,
}: {
  notice: GameNotice | null;
  raised?: boolean;
  overSheet?: boolean;
  visualOnly?: boolean;
}) {
  if (!notice || typeof document === 'undefined') return null;
  const error = notice.tone === 'error';
  return createPortal(
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] ${overSheet ? 'z-[1100]' : 'z-[60]'} flex justify-center px-4${raised ? ' max-md:bottom-[calc(11.5rem+env(safe-area-inset-bottom))]' : ' md:bottom-6'}`}
    >
      <div
        key={notice.id}
        role={visualOnly ? undefined : error ? 'alert' : 'status'}
        aria-hidden={visualOnly ? true : undefined}
        className={`pointer-events-auto max-w-md rounded-control px-4 py-3 text-sm font-semibold shadow-card ${
          error ? 'bg-danger-bg text-danger-fg' : notice.tone === 'info' ? 'bg-info-bg text-info-fg' : 'bg-forest-800 text-stone-0'
        }`}
      >
        {notice.text}
      </div>
    </div>,
    document.body,
  );
}
