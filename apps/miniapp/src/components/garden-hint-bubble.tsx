import { useEffect, useState } from 'react';
import { vi } from '../i18n/vi';
import { markGardenHintSeen, shouldShowGardenHint } from '../utils/garden-hint';
import { Text } from './ui/text';

/** Bóng nổi trên thanh tab nên che nội dung phía sau; tự tắt sau ngần này để không cản khách đang xem trang. */
export const GARDEN_HINT_AUTO_HIDE_MS = 8000;

/**
 * Bóng gợi ý trỏ vào tab Vườn Xanh, chỉ hiện một lần trên mỗi máy. Đánh dấu "đã xem" ngay lúc hiện (không đợi khách
 * đóng) để tắt app giữa chừng cũng không bị nhắc lại. Tắt khi bấm bóng hoặc khi khách mở tab Vườn Xanh.
 */
export function GardenHintBubble({ onGardenTab }: { onGardenTab: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (onGardenTab) {
      markGardenHintSeen();
      setOpen(false);
      return;
    }
    if (shouldShowGardenHint()) {
      markGardenHintSeen();
      setOpen(true);
    }
  }, [onGardenTab]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setOpen(false), GARDEN_HINT_AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="status"
      onClick={() => setOpen(false)}
      className="tubu-press"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(100% + 34px)',
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
