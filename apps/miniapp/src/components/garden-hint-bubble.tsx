import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { vi } from '../i18n/vi';
import { markGardenHintSeen, shouldShowGardenHint } from '../utils/garden-hint';
import { Text } from './ui/text';

/** Bóng nổi trên thanh tab nên che nội dung phía sau; tự tắt sau ngần này để không cản khách đang xem trang. */
export const GARDEN_HINT_AUTO_HIDE_MS = 5000;
/** Chờ trang vẽ xong rồi mới hiện, để bóng không đè lên lúc khách đang nhìn màn đầu hay một lớp phủ đang mở. */
export const GARDEN_HINT_DELAY_MS = 1500;

const overlayOpen = () => typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

/** Bóng nằm đè một tiêu đề (tên trang, tên kệ như "Bán chạy nhất"): khách mất chữ đang đọc. Bỏ tiêu đề ẩn thị giác (sr-only, cỡ 1px). */
const coversHeading = (box: DOMRect) =>
  Array.from(document.querySelectorAll('h1, h2, h3')).some((h) => {
    const r = h.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
  });

/**
 * Bóng gợi ý trỏ vào tab Vườn Xanh, chỉ hiện một lần trên mỗi máy. Đánh dấu "đã xem" ngay lúc hiện (không đợi khách
 * đóng) để tắt app giữa chừng cũng không bị nhắc lại. Bấm bóng thì mở Vườn Xanh; tự tắt sau vài giây hoặc khi khách cuộn trang.
 * Chỗ bóng sắp nổi lên đang có tiêu đề thì chưa hiện (chưa đánh dấu): thử lại khi khách cuộn xong và dừng đủ lâu ở chỗ khác.
 */
export function GardenHintBubble({ onGardenTab, onOpenGarden }: { onGardenTab: boolean; onOpenGarden?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Hai cú chạm trong cùng một tác vụ đều thấy bóng trước khi `setOpen(false)` kịp vẽ, và đều gọi `navigate` (hai mục lịch sử).
  const opened = useRef(false);
  // Bóng đã thật sự hiện ở lần gắn này: thôi thử lại sau mỗi lần cuộn, kể cả khi bộ nhớ không ghi được cờ "đã xem".
  const shown = useRef(false);

  useEffect(() => {
    if (onGardenTab) {
      markGardenHintSeen();
      setOpen(false);
      return;
    }
    if (!shouldShowGardenHint()) return;
    shown.current = false;
    // Có lớp phủ đang mở thì bỏ lượt này, chưa đánh dấu "đã xem".
    const attempt = () => {
      if (shown.current || overlayOpen()) return;
      opened.current = false;
      setOpen(true);
    };
    let id = setTimeout(attempt, GARDEN_HINT_DELAY_MS);
    // Lượt trước bị bỏ (đè tiêu đề, lớp phủ): khách cuộn xong và dừng đủ lâu thì thử lại ở vị trí mới.
    const retry = () => {
      if (shown.current) return;
      clearTimeout(id);
      id = setTimeout(attempt, GARDEN_HINT_DELAY_MS);
    };
    document.addEventListener('scroll', retry, { capture: true, passive: true });
    return () => {
      clearTimeout(id);
      document.removeEventListener('scroll', retry, { capture: true });
    };
  }, [onGardenTab]);

  // Đo trước khi vẽ: đè tiêu đề thì gỡ ngay (khách không thấy bóng chớp lên), chưa đánh dấu "đã xem".
  useLayoutEffect(() => {
    if (!open || shown.current) return;
    if (box.current && coversHeading(box.current.getBoundingClientRect())) {
      setOpen(false);
      return;
    }
    shown.current = true;
    markGardenHintSeen();
  }, [open]);

  // Khách bắt đầu cuộn là đang đọc trang: gỡ bóng ngay để không che nội dung.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('scroll', close, { capture: true, passive: true });
    document.addEventListener('touchmove', close, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', close, { capture: true });
      document.removeEventListener('touchmove', close, { capture: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setOpen(false), GARDEN_HINT_AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={box}
      role="status"
      onClick={() => {
        if (opened.current) return;
        opened.current = true;
        setOpen(false);
        onOpenGarden?.();
      }}
      className="tubu-press"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(100% + 26px)',
        transform: 'translateX(-50%)',
        width: 'max-content',
        maxWidth: 'min(260px, calc(100vw - 32px))',
        minHeight: 44,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 14px',
        borderRadius: 'var(--radius-card)',
        background: 'var(--color-bg-inverse)',
        boxShadow: 'var(--elevation-2)',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      <Text variant="caption" tone="inverse" style={{ fontWeight: 600 }}>
        {vi.nav.gardenHint}
      </Text>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -6,
          width: 12,
          height: 12,
          background: 'var(--color-bg-inverse)',
          transform: 'translateX(-50%) rotate(45deg)',
        }}
      />
    </div>
  );
}
