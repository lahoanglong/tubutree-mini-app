'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface GameNotice {
  id: number;
  text: string;
  tone: 'success' | 'error';
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
 * Lỗi dùng role="alert" để đọc ngay; thành công dùng role="status". Đưa ra body với z-index trên Sheet (z-50): hộp xác
 * nhận được giữ mở khi lỗi (để gửi lại cùng Idempotency-Key) nên thông báo nằm trong trang sẽ bị nó che. Nằm trên thanh
 * điều hướng đáy của điện thoại kể cả khi có vùng an toàn của iPhone. `raised`: trang có thanh nhập dính đáy ở mọi cỡ
 * màn hình (/tu-van) thì giữ thông báo trên thanh đó, không hạ xuống md:bottom-6 vì sẽ đè vào ô nhập.
 */
export function GameNoticeBar({ notice, raised = false }: { notice: GameNotice | null; raised?: boolean }) {
  if (!notice || typeof document === 'undefined') return null;
  const error = notice.tone === 'error';
  return createPortal(
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4${raised ? ' max-md:bottom-[calc(11.5rem+env(safe-area-inset-bottom))]' : ' md:bottom-6'}`}
    >
      <div
        key={notice.id}
        role={error ? 'alert' : 'status'}
        className={`pointer-events-auto max-w-md rounded-control px-4 py-3 text-sm font-semibold shadow-card ${
          error ? 'bg-danger-bg text-danger-fg' : 'bg-forest-800 text-stone-0'
        }`}
      >
        {notice.text}
      </div>
    </div>,
    document.body,
  );
}
