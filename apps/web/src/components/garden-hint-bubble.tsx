'use client';

import { useEffect, useState } from 'react';
import { markGardenHintSeen, shouldShowGardenHint } from './garden-hint';

/**
 * Bóng gợi ý trỏ vào tab Vườn Xanh, chỉ hiện một lần trên mỗi máy (như `garden-hint-bubble.tsx` của Mini App). Đánh dấu "đã xem"
 * ngay lúc hiện để đóng trang giữa chừng cũng không bị nhắc lại. Tắt khi bấm bóng hoặc khi khách mở tab Vườn Xanh.
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
        padding: '10px 14px',
        borderRadius: 'var(--radius-card)',
        background: 'var(--color-bg-inverse)',
        boxShadow: 'var(--elevation-2)',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', fontWeight: 600, color: 'var(--color-text-inverse)' }}>
        Trồng cây mỗi ngày, nhận quà thật
      </span>
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
