'use client';

// Nguồn: apps/miniapp/src/components/ui/countdown.tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { countdownClockParts, countdownDelay, countdownFrame } from '@tubutree/app-core/commerce/countdown-tick';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { serverNow } from '@tubutree/app-core/server-clock';

export interface CountdownProps {
  /** Mốc kết thúc (ISO). Không đọc được thì coi như đã hết giờ. */
  endAt: string;
  /** clock: ô số HH:MM:SS nhảy từng giây (chỉ đầu khối Giờ vàng); text: "Kết thúc sau 2 giờ 05 phút" đổi theo phút. */
  mode: 'clock' | 'text';
  /** Gọi đúng một lần khi tới giờ (kể cả đã quá giờ lúc mount); đổi hàm giữa chừng không gọi lại. */
  onEnd?: () => void;
  /** Mặc định "Kết thúc sau"; suất sắp tới dùng "Bắt đầu sau". */
  kind?: 'ends' | 'starts';
}

const CELL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 22,
  height: 20,
  padding: '0 2px',
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-tag)',
  background: 'var(--color-countdown-bg)',
  color: 'var(--color-countdown-fg)',
  fontSize: 'var(--type-label-size)',
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};
const COLON: CSSProperties = { color: 'var(--color-flash-fg)', fontSize: 'var(--type-label-size)', fontWeight: 700, lineHeight: 1 };

/**
 * Đồng hồ đếm ngược dùng chung (Q3): ô số nền stone-900 ở đầu khối Giờ vàng, chữ theo phút ở nơi khác. Chữ nhìn thấy là
 * `aria-hidden`; tên đọc của `role="timer"` lấy từ bản đọc làm tròn xuống theo phút nên chỉ đổi khi sang phút mới, dù ô số nhảy
 * từng giây (không dùng `aria-live`, a11y B4). Một `setTimeout` nối tiếp theo `countdownDelay`, giờ theo `serverNow` (đồng hồ máy
 * khách hay lệch). Hết giờ thì ẩn, không hiện 00:00.
 *
 * Web: HTML dựng sẵn (ISR) có thể được trả sau giờ hết suất, nên render đầu và lúc hydrate chỉ có khung giữ chỗ không chữ số; giờ chỉ đọc sau
 * mount (bản Mini đọc ngay vì không có máy chủ dựng trang). Khung vẫn có ô rỗng để chiều rộng không nhảy khi số hiện ra.
 */
export function Countdown({ endAt, mode, onEnd, kind = 'ends' }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);
  const frame = now === null ? null : countdownFrame(Date.parse(endAt), now);

  useEffect(() => {
    const endMs = Date.parse(endAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = serverNow();
      setNow(t);
      const f = countdownFrame(endMs, t);
      if (!f.ended) timer = setTimeout(tick, countdownDelay(f.ms, mode));
    };
    tick();
    return () => clearTimeout(timer);
  }, [endAt, mode]);

  // Giữ hàm mới nhất qua ref: đổi `onEnd` không chạy lại effect nên không gọi hai lần.
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!frame?.ended || firedFor.current === endAt) return;
    firedFor.current = endAt;
    onEndRef.current?.();
  }, [frame?.ended, endAt]);

  const key = kind === 'starts' ? 'flash.startsIn' : 'flash.endsIn';
  if (!frame) {
    return (
      <span role="timer" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, visibility: 'hidden' }}>
        {mode === 'clock' &&
          [0, 1, 2].map((i) => (
            <span key={i} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {i > 0 && <span style={COLON}>:</span>}
              <span style={CELL} />
            </span>
          ))}
      </span>
    );
  }
  const parts = mode === 'clock' && !frame.ended ? countdownClockParts(frame.ms) : null;
  return (
    <span
      role="timer"
      aria-label={frame.ended ? undefined : fillCopy(key, { t: frame.spoken })}
      aria-hidden={frame.ended ? true : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, visibility: frame.ended ? 'hidden' : undefined, fontVariantNumeric: 'tabular-nums' }}
    >
      {frame.ended ? null : parts ? (
        <>
          {parts.prefix && (
            <span aria-hidden="true" style={{ color: 'var(--color-flash-fg)', fontSize: 'var(--type-caption-size)', fontWeight: 600, marginRight: 3 }}>
              {parts.prefix}
            </span>
          )}
          {parts.cells.map((c, i) => (
            <span key={i} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {i > 0 && <span style={COLON}>:</span>}
              <span data-testid="countdown-cell" style={CELL}>{c}</span>
            </span>
          ))}
        </>
      ) : (
        <span aria-hidden="true" style={{ color: 'var(--color-flash-fg)', fontSize: 'var(--type-caption-size)', fontWeight: 600 }}>
          {fillCopy(key, { t: frame.text })}
        </span>
      )}
    </span>
  );
}
