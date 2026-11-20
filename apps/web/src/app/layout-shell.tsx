'use client';

import type { ReactNode } from 'react';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';
import HideOnPortals from '@/components/hide-on-portals';
import PortalHeader from '@/components/admin/portal-header';
import { ReferralCapture } from '@/components/storefront-tracker';
import { AppGates } from '@/components/app-gates';
import BottomNav from '@/components/bottom-nav';
import BackButton from '@/components/mini/back-button';
import { ErrorReporter } from '@/components/error-reporter';
import { EntrySourceCapture } from '@/components/entry-source-capture';
import { ScreenTracker } from '@/components/analytics/screen-tracker';
import { PdpNavSkeleton } from '@/components/skeletons/pdp-nav-skeleton';
import { SkipLink } from '@/components/skip-link';

/**
 * Phần client của khung trang chung, gom trong MỘT thành phần client: mỗi thành phần client mà layout server dựng trực tiếp thêm một dòng
 * tham chiếu vào dữ liệu RSC của MỌI trang, và dòng đó chép lại cả danh sách chunk của layout (~0,8 KB). Mười ba thành phần riêng là ~10 KB
 * HTML trên mỗi trang. Phần server (đo tốc độ, chân trang, nội dung trang) đi vào qua prop, đúng chỗ cũ.
 */
export function LayoutShell({ vitals, footer, children }: { vitals: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <Providers>
      {/* Link CTV chia sẻ thường trỏ thẳng tới trang sản phẩm kèm ?ref= — bắt ở mọi trang. */}
      <ReferralCapture />
      <EntrySourceCapture />
      <ScreenTracker />
      {vitals}
      <ErrorReporter />
      <AppGates />
      <PdpNavSkeleton />
      <SkipLink />
      {/* Nút lùi nổi (position: fixed) đặt trước nội dung để thứ tự Tab/đọc màn hình khớp vị trí: ở điện thoại nó là điểm dừng đầu của trang con, không phải cuối cùng sau chân trang. */}
      <HideOnPortals>
        <BackButton className="md:!hidden" />
      </HideOnPortals>
      <HideOnPortals>
        <SiteHeader />
      </HideOnPortals>
      <PortalHeader />
      {children}
      <HideOnPortals>{footer}</HideOnPortals>
      <HideOnPortals>
        <BottomNav />
      </HideOnPortals>
    </Providers>
  );
}
