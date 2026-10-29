'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import { guestCheckInCopy } from '@tubutree/app-core/daily-check-in-guest-copy';
import { loginHref } from '@/lib/return-to';
import { miniBtnSecondary } from './mini-surface';

/**
 * Khách vãng lai điểm danh hoặc xem nhiệm vụ vẫn nhận giọt nước nhưng không nhận Điểm Xanh (API báo `pointsBlocked`): một câu
 * mời đăng nhập Zalo kèm nút, cùng bố cục với `GuestPointsNote` của Mini App. Đăng nhập xong quay lại đúng trang này.
 */
export function GuestPointsNote({ margin }: { margin?: string }) {
  const pathname = usePathname();
  return (
    <div
      role="note"
      data-testid="guest-points-note"
      style={{ margin, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <p className="text-sm font-semibold text-stone-700">{checkInCopy.guestPoints}</p>
      <Link href={loginHref(pathname)} className={`${miniBtnSecondary} w-full`}>
        {guestCheckInCopy.cta}
      </Link>
    </div>
  );
}
