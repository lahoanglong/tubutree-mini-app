'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

/** Lỗi dùng role="alert" để đọc ngay; thành công dùng role="status". Nằm trên thanh điều hướng đáy của điện thoại. */
export function GameNoticeBar({ notice }: { notice: GameNotice | null }) {
  if (!notice) return null;
  const error = notice.tone === 'error';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
      <div
        key={notice.id}
        role={error ? 'alert' : 'status'}
        className={`pointer-events-auto max-w-md rounded-control px-4 py-3 text-sm font-semibold shadow-card ${
          error ? 'bg-danger-bg text-danger-fg' : 'bg-forest-800 text-stone-0'
        }`}
      >
        {notice.text}
      </div>
    </div>
  );
}
