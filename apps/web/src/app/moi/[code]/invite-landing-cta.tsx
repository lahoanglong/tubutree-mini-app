'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackWebEvent } from '@/lib/analytics';
import { ui } from '@/lib/guest-ui';

/** Nút duy nhất của trang đích link mời; báo `invite_landing_viewed` khi trang mở và `invite_landing_cta` khi bấm (không mang mã mời). */
export function InviteLandingCta({ href }: { href: string }) {
  useEffect(() => {
    trackWebEvent('invite_landing_viewed', {});
  }, []);
  return (
    <Link href={href} className={`${ui.btnPrimary} mt-2 w-full md:w-auto`} onClick={() => trackWebEvent('invite_landing_cta', {})}>
      {fillCopy('invite.landing.cta')}
    </Link>
  );
}
