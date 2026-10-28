'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { markGardenHintSeen, shouldShowGardenHint } from './garden-hint';

/** Bóng nổi trên thanh tab nên che nội dung phía sau; tự tắt sau ngần này để không cản khách đang xem trang. */
export const GARDEN_HINT_AUTO_HIDE_MS = 5000;
/** Chờ trang vẽ xong rồi mới hiện, để bóng không đè lên lúc khách đang nhìn màn đầu hay một lớp phủ đang mở. */
export const GARDEN_HINT_DELAY_MS = 1500;

const overlayOpen = () => typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

/**
 * Bóng gợi ý trỏ vào tab Vườn Xanh, chỉ hiện một lần trên mỗi máy (như `garden-hint-bubble.tsx` của Mini App). Đánh dấu "đã xem"
 * ngay lúc hiện để đóng trang giữa chừng cũng không bị nhắc lại. Bấm bóng thì mở Vườn Xanh; tự tắt sau vài giây hoặc khi khách cuộn trang.
 */
export function GardenHintBubble({ onGardenTab }: { onGardenTab: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (onGardenTab) {
      markGardenHintSeen();
      setOpen(false);
      return;
    }
    if (!shouldShowGardenHint()) return;
    // Chỉ hiện và đánh dấu "đã xem" khi không có lớp phủ nào đang mở: nếu có, lần mở sau mới thử lại.
    const id = setTimeout(() => {
      if (overlayOpen()) return;
      markGardenHintSeen();
      setOpen(true);
    }, GARDEN_HINT_DELAY_MS);
    return () => clearTimeout(id);
  }, [onGardenTab]);

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
      role="status"
      onClick={() => {
        setOpen(false);
        router.push('/vuon-xanh');
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
      <Link
        href="/vuon-xanh"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
        }}
        style={{ fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', fontWeight: 600, color: 'var(--color-text-inverse)', textDecoration: 'none' }}
      >
        Trồng cây mỗi ngày, nhận quà thật
      </Link>
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
